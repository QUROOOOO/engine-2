"""Step 5B: 12-Qubit QUBO (Simulated Annealing) vs SciPy HiGHS MILP.

Formulates the multi-conjunction maneuver scheduling problem as a
combinatorial optimisation:

* **QUBO** – Quadratic Unconstrained Binary Optimisation solved via
  classical Simulated Annealing (quantum-inspired).
* **MILP** – Mixed-Integer Linear Programme solved exactly by SciPy's
  HiGHS backend.

Both solvers select exactly one burn option per conjunction event to
minimise total Δv while keeping the post-maneuver miss distance above
the 5.0 km safety threshold.
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import milp, LinearConstraint, Bounds
import logging
import json
from pathlib import Path

logger = logging.getLogger(__name__)
OUTPUTS_DIR = Path(__file__).resolve().parent.parent / "outputs"

# ---------------------------------------------------------------------------
# Burn option catalogue (12 candidates per conjunction)
# 3 axes × 2 lead-time buckets × 2 Δv levels = 12
# ---------------------------------------------------------------------------
_AXES = ["Along-Track", "Cross-Track", "Hybrid"]
_LEAD_TIMES = ["early_gt4h", "late_lt4h"]
_DV_LEVELS = [0.5, 2.0]  # m/s

# CW-like directional efficiency multipliers
_AXIS_EFF = {"Along-Track": 1.0, "Cross-Track": 0.45, "Hybrid": 0.72}
# Lead-time gain: earlier burn → more effective
_LEAD_GAIN = {"early_gt4h": 1.6, "late_lt4h": 0.7}


def _build_burn_catalog() -> list[dict]:
    """Return the fixed 12-option burn catalogue."""
    catalog: list[dict] = []
    for axis in _AXES:
        for lt in _LEAD_TIMES:
            for dv in _DV_LEVELS:
                catalog.append(
                    {"axis": axis, "lead_time": lt, "dv_ms": dv, "eff": _AXIS_EFF[axis], "lt_gain": _LEAD_GAIN[lt]}
                )
    return catalog


_BURN_CATALOG = _build_burn_catalog()  # module-level singleton


def _estimate_post_miss(pre_miss_km: float, burn: dict) -> float:
    """Simplified CW post-miss distance estimate (km)."""
    n = 0.00113  # LEO mean motion rad/s
    dt_s = 5.0 * 3600.0 if burn["lt_gain"] > 1.0 else 2.0 * 3600.0
    delta_km = burn["eff"] * burn["lt_gain"] * 1.5 * n * (burn["dv_ms"] / 1000.0) * dt_s**2 / 1000.0
    return pre_miss_km + float(np.clip(delta_km, 0.0, 500.0))


# ====================================================================== #
#  Scenario extraction helpers
# ====================================================================== #

def _extract_scenarios(data: dict, n: int) -> list[dict]:
    """Pull *n* conjunction scenarios from the test DataFrame in *data*.

    Each scenario dict has at least ``pre_miss_km`` and
    ``available_fuel_dv_ms``.
    """
    df = data.get("df_test", data.get("df_train"))
    if df is None:
        raise ValueError("data dict must contain 'df_test' or 'df_train'")

    n = min(n, len(df))
    scenarios: list[dict] = []
    for i in range(n):
        row = df.iloc[i]
        s: dict = {}
        # Try column names first; fall back to positional index
        if "pre_maneuver_miss_dist_km" in df.columns:
            s["pre_miss_km"] = float(row["pre_maneuver_miss_dist_km"])
        else:
            s["pre_miss_km"] = float(row.iloc[1])

        if "available_fuel_dv_ms" in df.columns:
            s["available_fuel_dv_ms"] = float(row["available_fuel_dv_ms"])
        else:
            s["available_fuel_dv_ms"] = float(row.iloc[11])

        if "collision_prob_pc" in df.columns:
            s["collision_prob_pc"] = float(row["collision_prob_pc"])
        else:
            s["collision_prob_pc"] = float(row.iloc[3])

        scenarios.append(s)
    return scenarios


# ====================================================================== #
#  QUBO construction
# ====================================================================== #

def build_qubo_matrix(
    scenarios: list[dict],
    n_burn_options: int = 12,
) -> tuple[np.ndarray, list[dict]]:
    """Build the QUBO *Q* matrix for multi-conjunction maneuver scheduling.

    Binary variables
    ~~~~~~~~~~~~~~~~
    ``x[k * n_burn_options + b]`` = 1 iff conjunction *k* uses burn
    option *b* from the catalogue.

    Objective ``x^T Q x``
    ~~~~~~~~~~~~~~~~~~~~~
    * **Diagonal** ``Q[i,i]``: fuel cost of burn *b* plus a large
      penalty (+500) if the burn does **not** achieve a post-miss
      distance ≥ 5.0 km.
    * **Off-diagonal** (one-hot penalty): for every pair of burn
      options belonging to the **same** conjunction, add ``λ`` to
      ``Q[i,j]`` and ``Q[j,i]`` so that selecting more than one
      option is heavily penalised.

    Parameters
    ----------
    scenarios : list[dict]
        Each dict must contain ``pre_miss_km`` (float).
    n_burn_options : int
        Defaults to 12.

    Returns
    -------
    Q : ndarray, shape ``(K*n_burn_options, K*n_burn_options)``
    burn_catalog : list[dict]
    """
    K = len(scenarios)
    N = K * n_burn_options
    Q = np.zeros((N, N), dtype=np.float64)

    catalog = _BURN_CATALOG[:n_burn_options]
    lam = 100.0  # one-hot constraint penalty weight

    for k, sc in enumerate(scenarios):
        pre_miss = sc.get("pre_miss_km", 2.0)
        avail_fuel = sc.get("available_fuel_dv_ms", 5.0)

        for b, burn in enumerate(catalog):
            idx = k * n_burn_options + b

            # --- fuel cost (linear → on diagonal) ---
            fuel_cost = burn["dv_ms"]

            # --- safety penalty ---
            post_miss = _estimate_post_miss(pre_miss, burn)
            safety_penalty = 0.0 if post_miss >= 5.0 else 500.0

            # --- fuel-availability penalty ---
            fuel_avail_penalty = 0.0 if burn["dv_ms"] <= avail_fuel else 300.0

            Q[idx, idx] = fuel_cost + safety_penalty + fuel_avail_penalty

            # --- one-hot off-diagonal penalty within same conjunction ---
            for b2 in range(b + 1, n_burn_options):
                j = k * n_burn_options + b2
                Q[idx, j] += lam
                Q[j, idx] += lam

    # Also add the constant one-hot offset on the diagonal:
    # E_one_hot = λ (Σ x_b - 1)^2 = λ (Σ x_b^2 + 2 ΣΣ x_i x_j - 2 Σ x_b + 1)
    # The cross-term is already above; add the diagonal component (-2λ)
    # and the constant (+λ) is irrelevant for optimisation.
    for k in range(K):
        for b in range(n_burn_options):
            idx = k * n_burn_options + b
            Q[idx, idx] -= 2.0 * lam  # favours selecting exactly one

    return Q, catalog


# ====================================================================== #
#  Simulated Annealing solver
# ====================================================================== #

def _random_one_hot_vector(K: int, Nb: int, rng: np.random.Generator) -> np.ndarray:
    """Return a binary vector of length K*Nb with exactly one 1 per
    conjunction block."""
    x = np.zeros(K * Nb, dtype=np.float64)
    for k in range(K):
        b = rng.integers(0, Nb)
        x[k * Nb + b] = 1.0
    return x


def _qubo_energy(x: np.ndarray, Q: np.ndarray) -> float:
    return float(x @ Q @ x)


def simulated_annealing_qubo(
    Q: np.ndarray,
    n_vars_per_conj: int = 12,
    n_conjunctions: int = 10,
    n_reads: int = 200,
    T_init: float = 10.0,
    T_final: float = 0.01,
    cooling_rate: float = 0.995,
) -> tuple[np.ndarray, float]:
    """Solve the QUBO via Simulated Annealing while maintaining the
    one-hot constraint per conjunction.

    Algorithm
    ---------
    1. Initialise a random one-hot binary vector.
    2. At each temperature step, pick a random conjunction and swap its
       selected burn option to a different one (preserving one-hot).
    3. Accept the move if ΔE < 0, otherwise with probability
       ``exp(−ΔE / T)``.
    4. Cool: ``T *= cooling_rate``.
    5. Repeat *n_reads* independent runs; return the best.

    Returns
    -------
    best_x : ndarray, shape ``(K * n_vars_per_conj,)``
    best_energy : float
    """
    Nb = n_vars_per_conj
    K = n_conjunctions
    rng = np.random.default_rng(seed=42)

    n_steps = int(np.log(T_final / T_init) / np.log(cooling_rate)) + 1

    best_x: np.ndarray | None = None
    best_energy = np.inf

    for _ in range(n_reads):
        x = _random_one_hot_vector(K, Nb, rng)
        E = _qubo_energy(x, Q)
        T = T_init

        local_best_x = x.copy()
        local_best_E = E

        for _ in range(n_steps):
            # Pick a random conjunction and swap its active burn
            k = rng.integers(0, K)
            start = k * Nb
            old_b = int(np.argmax(x[start: start + Nb]))
            new_b = rng.integers(0, Nb - 1)
            if new_b >= old_b:
                new_b += 1  # ensure different

            # Flip
            x_new = x.copy()
            x_new[start + old_b] = 0.0
            x_new[start + new_b] = 1.0
            E_new = _qubo_energy(x_new, Q)

            dE = E_new - E
            if dE < 0 or rng.random() < np.exp(-dE / max(T, 1e-12)):
                x = x_new
                E = E_new

            if E < local_best_E:
                local_best_E = E
                local_best_x = x.copy()

            T *= cooling_rate

        if local_best_E < best_energy:
            best_energy = local_best_E
            best_x = local_best_x.copy()

    if best_x is None:
        best_x = _random_one_hot_vector(K, Nb, rng)
        best_energy = _qubo_energy(best_x, Q)

    return best_x, best_energy


# ====================================================================== #
#  Exact MILP solver (SciPy HiGHS)
# ====================================================================== #

def solve_milp_exact(
    scenarios: list[dict],
    n_burn_options: int = 12,
) -> tuple[np.ndarray, float]:
    """Solve the maneuver selection problem exactly as a MILP.

    Variables
    ---------
    ``x[k*Nb + b]  ∈ {0, 1}``

    Objective
    ---------
    Minimise ``Σ c[i] * x[i]`` where ``c[i]`` = fuel_cost + safety
    penalty (same values as QUBO diagonal, but without the one-hot
    offset).

    Constraints
    -----------
    * One-hot per conjunction: ``Σ_b x[k*Nb + b] = 1`` for each *k*.

    Returns
    -------
    x_opt : ndarray  (binary solution)
    obj   : float    (optimal objective value)
    """
    K = len(scenarios)
    Nb = n_burn_options
    N = K * Nb
    catalog = _BURN_CATALOG[:Nb]

    # --- Cost vector c ---
    c = np.zeros(N, dtype=np.float64)
    for k, sc in enumerate(scenarios):
        pre_miss = sc.get("pre_miss_km", 2.0)
        avail_fuel = sc.get("available_fuel_dv_ms", 5.0)
        for b, burn in enumerate(catalog):
            idx = k * Nb + b
            fuel_cost = burn["dv_ms"]
            post_miss = _estimate_post_miss(pre_miss, burn)
            safety_pen = 0.0 if post_miss >= 5.0 else 500.0
            avail_pen = 0.0 if burn["dv_ms"] <= avail_fuel else 300.0
            c[idx] = fuel_cost + safety_pen + avail_pen

    # --- One-hot equality constraints: A_eq x = 1 for each conjunction ---
    A_eq = np.zeros((K, N), dtype=np.float64)
    for k in range(K):
        A_eq[k, k * Nb: (k + 1) * Nb] = 1.0
    b_eq = np.ones(K, dtype=np.float64)

    constraints = LinearConstraint(A_eq, b_eq, b_eq)  # equality
    bounds = Bounds(lb=0, ub=1)
    integrality = np.ones(N, dtype=int)  # all binary

    result = milp(
        c=c,
        constraints=constraints,
        bounds=bounds,
        integrality=integrality,
        options={"disp": False, "time_limit": 30},
    )

    if result.success:
        x_opt = np.round(result.x).astype(np.float64)
        obj = float(result.fun)
    else:
        logger.warning("MILP solver did not converge: %s — using fallback", result.message)
        # Fallback: pick cheapest feasible burn per conjunction
        x_opt = np.zeros(N, dtype=np.float64)
        obj = 0.0
        for k in range(K):
            best_b = int(np.argmin(c[k * Nb: (k + 1) * Nb]))
            x_opt[k * Nb + best_b] = 1.0
            obj += c[k * Nb + best_b]

    return x_opt, obj


# ====================================================================== #
#  Solution decoding helpers
# ====================================================================== #

def _decode_solution(x: np.ndarray, n_burn_options: int = 12) -> list[dict]:
    """Decode a binary solution vector into human-readable assignments."""
    K = len(x) // n_burn_options
    catalog = _BURN_CATALOG[:n_burn_options]
    assignments: list[dict] = []
    for k in range(K):
        block = x[k * n_burn_options: (k + 1) * n_burn_options]
        b = int(np.argmax(block))
        burn = catalog[b]
        assignments.append(
            {
                "conjunction": k,
                "burn_option": b,
                "axis": burn["axis"],
                "lead_time": burn["lead_time"],
                "dv_ms": burn["dv_ms"],
            }
        )
    return assignments


def _total_fuel(x: np.ndarray, n_burn_options: int = 12) -> float:
    """Total Δv (m/s) implied by solution vector *x*."""
    catalog = _BURN_CATALOG[:n_burn_options]
    K = len(x) // n_burn_options
    total = 0.0
    for k in range(K):
        b = int(np.argmax(x[k * n_burn_options: (k + 1) * n_burn_options]))
        total += catalog[b]["dv_ms"]
    return total


def _greedy_fuel(K: int) -> float:
    """Fuel used by a greedy baseline that always chooses the highest Δv
    burn (2.0 m/s) for every conjunction."""
    return K * max(b["dv_ms"] for b in _BURN_CATALOG)


# ====================================================================== #
#  Entry point
# ====================================================================== #

def run_qubo_milp(data: dict, n_test_conjunctions: int = 10) -> dict:
    """Build QUBO for *n_test_conjunctions*, solve with SA and MILP,
    compare results.

    Parameters
    ----------
    data : dict
        Must contain ``'df_test'`` (or ``'df_train'``).
    n_test_conjunctions : int
        Number of conjunction events to optimise over (default 10).

    Returns
    -------
    dict with keys:
        qubo_energy, milp_objective, approximation_ratio,
        qubo_fuel_total_ms, milp_fuel_total_ms,
        fuel_saved_vs_greedy_pct, n_conjunctions, n_binary_variables,
        qubo_assignments, milp_assignments
    """
    logger.info("Step 5B: Running QUBO/MILP solvers...")

    Nb = 12
    scenarios = _extract_scenarios(data, n_test_conjunctions)
    K = len(scenarios)  # may be < n_test_conjunctions if dataset is small
    N = K * Nb

    logger.info("  Conjunctions=%d, burn options=%d → %d binary variables", K, Nb, N)

    # ---- QUBO + Simulated Annealing ----
    Q, catalog = build_qubo_matrix(scenarios, n_burn_options=Nb)
    sa_x, sa_energy = simulated_annealing_qubo(
        Q,
        n_vars_per_conj=Nb,
        n_conjunctions=K,
        n_reads=200,
        T_init=10.0,
        T_final=0.01,
        cooling_rate=0.995,
    )

    # ---- Exact MILP ----
    milp_x, milp_obj = solve_milp_exact(scenarios, n_burn_options=Nb)

    # ---- Metrics ----
    qubo_fuel = _total_fuel(sa_x, Nb)
    milp_fuel = _total_fuel(milp_x, Nb)
    greedy_fuel = _greedy_fuel(K)

    # Approximation ratio: compare QUBO linear cost to MILP linear cost
    # (not QUBO energy which includes quadratic penalties)
    milp_linear = milp_obj if milp_obj > 0 else 1e-9
    # Compute SA linear cost the same way MILP does (just the c vector dot x)
    # Re-derive c quickly:
    c = np.zeros(N, dtype=np.float64)
    for k, sc in enumerate(scenarios):
        pre_miss = sc.get("pre_miss_km", 2.0)
        avail_fuel = sc.get("available_fuel_dv_ms", 5.0)
        for b, burn in enumerate(catalog):
            idx = k * Nb + b
            fuel_cost = burn["dv_ms"]
            post_miss = _estimate_post_miss(pre_miss, burn)
            safety_pen = 0.0 if post_miss >= 5.0 else 500.0
            avail_pen = 0.0 if burn["dv_ms"] <= avail_fuel else 300.0
            c[idx] = fuel_cost + safety_pen + avail_pen
    sa_linear_cost = float(sa_x @ c)
    approx_ratio = sa_linear_cost / milp_linear if milp_linear > 0 else 1.0
    # Clamp to [0, 2] for display sanity
    approx_ratio = float(np.clip(approx_ratio, 0.0, 2.0))

    fuel_saved_pct = (1.0 - milp_fuel / greedy_fuel) * 100.0 if greedy_fuel > 0 else 0.0

    metrics: dict = {
        "qubo_energy": round(float(sa_energy), 4),
        "milp_objective": round(float(milp_obj), 4),
        "approximation_ratio": round(approx_ratio, 4),
        "qubo_fuel_total_ms": round(qubo_fuel, 3),
        "milp_fuel_total_ms": round(milp_fuel, 3),
        "fuel_saved_vs_greedy_pct": round(fuel_saved_pct, 2),
        "n_conjunctions": K,
        "n_binary_variables": N,
    }

    logger.info(
        "  QUBO energy=%.2f | MILP obj=%.2f | approx ratio=%.4f",
        sa_energy,
        milp_obj,
        approx_ratio,
    )
    logger.info(
        "  SA fuel=%.1f m/s | MILP fuel=%.1f m/s | greedy fuel=%.1f m/s | saved %.1f%%",
        qubo_fuel,
        milp_fuel,
        greedy_fuel,
        fuel_saved_pct,
    )

    # ---- Persist detailed results ----
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    details = {
        **metrics,
        "qubo_assignments": _decode_solution(sa_x, Nb),
        "milp_assignments": _decode_solution(milp_x, Nb),
    }
    out_path = OUTPUTS_DIR / "qubo_milp_results.json"
    with open(out_path, "w") as f:
        json.dump(details, f, indent=2)
    logger.info("  Detailed results → %s", out_path)

    return metrics
