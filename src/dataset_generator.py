"""Step 2: 10,000 x 24 Clohessy-Wiltshire physics simulator.

Simulates orbital conjunction scenarios between active LEO satellites and
space debris using Clohessy-Wiltshire (Hill's) relative motion equations
and Foster 2D Gaussian collision probability (Pc).
"""

import numpy as np
import pandas as pd
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Physical constants
MU_EARTH = 3.986004418e5  # km³/s² (Earth gravitational parameter)
R_EARTH = 6371.0  # km (Earth mean radius)

# NORAD IDs for ISRO Cartosat / EOS satellites
ISRO_SAT_IDS = [43689, 44804, 49260, 52265, 55562]

# Exact 24-column schema required by specification
COLUMNS = [
    # Crisis Inputs X1 (8 columns)
    "conjunction_id",
    "active_sat_norad_id",
    "debris_norad_id",
    "time_to_tca_hours",
    "pre_maneuver_miss_dist_km",
    "relative_velocity_kms",
    "collision_prob_pc",
    "crossing_angle_deg",
    # Orbital & Fleet Constraints X2 (10 columns)
    "sat_altitude_km",
    "sat_inclination_deg",
    "rel_pos_R_km",
    "rel_pos_T_km",
    "rel_pos_N_km",
    "cov_sigma_T_m",
    "available_fuel_dv_ms",
    "min_impulse_bit_ms",
    "target_pass_conflict_flag",
    "mission_priority_tier",
    # Physics Cost Inputs X3 (3 columns)
    "dv_cost_prograde_ms",
    "dv_cost_normal_ms",
    "orbital_drift_penalty_km",
    # Target Outputs Y (3 columns)
    "optimal_maneuver_strategy",
    "optimal_burn_dv_ms",
    "post_maneuver_miss_dist_km",
]


# ---------------------------------------------------------------------------
# Physics functions
# ---------------------------------------------------------------------------

def compute_orbital_rate(altitude_km: np.ndarray) -> np.ndarray:
    """Mean orbital angular rate n = sqrt(mu / a^3) in rad/s."""
    a = R_EARTH + altitude_km
    return np.sqrt(MU_EARTH / a**3)


def cw_delta_v_along_track(
    miss_dist_target_km: float,
    current_miss_T_km: np.ndarray,
    time_to_tca_s: np.ndarray,
    n: np.ndarray,
) -> np.ndarray:
    """Clohessy-Wiltshire along-track (prograde/retrograde) delta-v in m/s.

    Under Hill's equations, an along-track burn produces secular along-track drift:
        delta_x(t) ~= -6 * (delta_v / n) * (n*t - sin(n*t)) ~= -6 * delta_v * t (secular)
    For a simplified target separation:
        delta_v_T ~= |target - current| / (3 * t)   (in km/s, convert to m/s)
    """
    delta_x_km = np.abs(miss_dist_target_km - np.abs(current_miss_T_km))
    safe_t = np.maximum(time_to_tca_s, 60.0)  # avoid division by zero
    # dv in km/s = delta_x / (3 * t)
    dv_kms = delta_x_km / (3.0 * safe_t)
    return dv_kms * 1000.0  # m/s


def cw_delta_v_normal(
    miss_dist_target_km: float,
    current_miss_N_km: np.ndarray,
    time_to_tca_s: np.ndarray,
    n: np.ndarray,
) -> np.ndarray:
    """CW cross-track (normal/out-of-plane) delta-v in m/s.

    Cross-track motion is decoupled harmonic oscillation:
        delta_z(t) = (delta_v_N / n) * sin(n*t)
        delta_v_N = delta_z * n / |sin(n*t)|
    """
    delta_z_km = np.abs(miss_dist_target_km - np.abs(current_miss_N_km))
    sin_term = np.abs(np.sin(n * time_to_tca_s))
    safe_sin = np.maximum(sin_term, 0.15)
    dv_kms = delta_z_km * n / safe_sin
    return dv_kms * 1000.0  # m/s


def foster_collision_probability(
    miss_dist_km: np.ndarray,
    sigma_T_m: np.ndarray,
    sigma_N_m: np.ndarray,
    sat_radius_m: float = 5.0,
    debris_radius_m: float = 0.5,
) -> np.ndarray:
    """Foster 2D Gaussian collision probability (Pc)."""
    r_combined = sat_radius_m + debris_radius_m  # metres
    miss_m = np.asarray(miss_dist_km, dtype=np.float64) * 1000.0  # -> metres

    miss_T_m = miss_m / np.sqrt(2.0)
    miss_N_m = miss_m / np.sqrt(2.0)

    sig_T = np.maximum(np.asarray(sigma_T_m, dtype=np.float64), 1.0)
    sig_N = np.maximum(np.asarray(sigma_N_m, dtype=np.float64), 1.0)

    area = np.pi * r_combined ** 2
    norm = 2.0 * np.pi * sig_T * sig_N
    exponent = -0.5 * ((miss_T_m / sig_T) ** 2 + (miss_N_m / sig_N) ** 2)

    pc = (area / norm) * np.exp(np.clip(exponent, -60.0, 0.0))
    return np.clip(pc, 0.0, 1.0)


# ---------------------------------------------------------------------------
# Deterministic Strategy Assignment
# ---------------------------------------------------------------------------

def assign_maneuver_strategy(
    time_to_tca: np.ndarray,
    pre_miss: np.ndarray,
    pc: np.ndarray,
    pass_conflict: np.ndarray,
    fuel_avail: np.ndarray,
    dv_T: np.ndarray,
    dv_N: np.ndarray,
) -> np.ndarray:
    """Deterministic strategy assignment following physical rules.

    Class 3 (Hold)       : pre_miss >= 5.0 AND pc < 1e-4, OR insufficient fuel
    Class 2 (Hybrid Emrg): time_to_tca < 4.0 AND pre_miss < 5.0 (emergency late alert)
    Class 1 (Cross-Track): pass_conflict == 1 OR (dv_N < dv_T AND dv_N <= fuel_avail)
    Class 0 (Along-Track): time_to_tca >= 4.0 AND pass_conflict == 0 AND dv_T <= fuel_avail
    """
    n = len(time_to_tca)
    strategy = np.zeros(n, dtype=np.int32)

    # Class 3: Hold (already safe, or no fuel to burn)
    hold_mask = ((pre_miss >= 5.0) & (pc < 1e-4)) | ((fuel_avail < dv_T) & (fuel_avail < dv_N))
    strategy[hold_mask] = 3

    # Class 2: Hybrid emergency burn (late alert < 4h and in danger)
    emergency_mask = (~hold_mask) & (time_to_tca < 4.0) & (pre_miss < 5.0)
    strategy[emergency_mask] = 2

    # Class 1: Cross-track (imaging conflict or cross-track cheaper)
    cross_mask = (~hold_mask) & (~emergency_mask) & (
        (pass_conflict == 1) | ((dv_N < dv_T) & (dv_N <= fuel_avail))
    )
    strategy[cross_mask] = 1

    # Class 0: Along-track phasing (default remaining)
    # already initialized to 0

    return strategy


# ---------------------------------------------------------------------------
# Main dataset generator
# ---------------------------------------------------------------------------

def generate_dataset(n_scenarios: int = 10000, seed: int = 42) -> pd.DataFrame:
    """Generate the full 10,000 x 24 dataset with balanced operational regimes."""
    rng = np.random.default_rng(seed)
    n = n_scenarios

    conjunction_id = np.arange(n, dtype=np.int64)
    active_sat_norad_id = rng.choice(ISRO_SAT_IDS, size=n)
    debris_norad_id = rng.integers(25000, 40000, size=n, dtype=np.int64)

    # Stratified regimes to ensure balanced class distribution naturally
    regime = rng.choice([0, 1, 2, 3], size=n, p=[0.25, 0.25, 0.25, 0.25])

    # Time to TCA (hours)
    time_to_tca_hours = np.zeros(n)
    time_to_tca_hours[regime == 2] = rng.uniform(0.5, 3.99, size=np.sum(regime == 2))
    time_to_tca_hours[regime != 2] = rng.uniform(4.0, 72.0, size=np.sum(regime != 2))

    # Pre-maneuver miss distance (km)
    pre_maneuver_miss_dist_km = np.zeros(n)
    pre_maneuver_miss_dist_km[regime == 3] = rng.uniform(5.0, 8.0, size=np.sum(regime == 3))
    pre_maneuver_miss_dist_km[regime != 3] = np.exp(
        rng.uniform(np.log(0.05), np.log(4.99), size=np.sum(regime != 3))
    )

    relative_velocity_kms = rng.uniform(7.5, 15.2, size=n)
    crossing_angle_deg = rng.uniform(0.0, 180.0, size=n)

    sat_altitude_km = rng.uniform(450.0, 850.0, size=n)
    sat_inclination_deg = rng.uniform(50.0, 99.0, size=n)

    cov_sigma_T_m = rng.uniform(50.0, 1500.0, size=n)
    available_fuel_dv_ms = rng.uniform(0.2, 15.0, size=n)
    min_impulse_bit_ms = rng.uniform(0.005, 0.05, size=n)

    # Imaging conflict flag
    target_pass_conflict_flag = np.zeros(n, dtype=np.int32)
    target_pass_conflict_flag[regime == 1] = 1
    target_pass_conflict_flag[regime == 0] = 0
    target_pass_conflict_flag[regime >= 2] = rng.binomial(1, 0.3, size=np.sum(regime >= 2))

    mission_priority_tier = rng.choice([1, 2, 3], size=n, p=[0.5, 0.3, 0.2]).astype(np.int32)

    # RTN components
    angle_rad = np.deg2rad(crossing_angle_deg)
    rel_pos_T_km = pre_maneuver_miss_dist_km * np.cos(angle_rad)
    rel_pos_N_km = pre_maneuver_miss_dist_km * np.sin(angle_rad)
    rel_pos_R_km = rng.uniform(-0.5, 0.5, size=n)

    # Collision probability via Foster formula
    cov_sigma_N_m = cov_sigma_T_m * rng.uniform(0.3, 0.7, size=n)
    collision_prob_pc = foster_collision_probability(
        pre_maneuver_miss_dist_km, cov_sigma_T_m, cov_sigma_N_m
    )
    # Ensure hold regime has pc < 1e-4
    collision_prob_pc[regime == 3] = np.minimum(collision_prob_pc[regime == 3], 9.5e-5)

    # CW delta-v costs
    n_rate = compute_orbital_rate(sat_altitude_km)
    time_to_tca_s = time_to_tca_hours * 3600.0

    dv_cost_prograde_ms = cw_delta_v_along_track(
        miss_dist_target_km=5.0,
        current_miss_T_km=rel_pos_T_km,
        time_to_tca_s=time_to_tca_s,
        n=n_rate,
    )
    dv_cost_normal_ms = cw_delta_v_normal(
        miss_dist_target_km=5.0,
        current_miss_N_km=rel_pos_N_km,
        time_to_tca_s=time_to_tca_s,
        n=n_rate,
    )

    dv_cost_prograde_ms = np.clip(dv_cost_prograde_ms, 0.0, 50.0)
    dv_cost_normal_ms = np.clip(dv_cost_normal_ms, 0.0, 50.0)

    # Orbital drift penalty proportional to prograde dv
    orbital_drift_penalty_km = dv_cost_prograde_ms * rng.uniform(0.01, 0.08, size=n)
    orbital_drift_penalty_km = np.clip(orbital_drift_penalty_km, 0.0, 5.0)

    # Deterministic strategy assignment
    strategy = assign_maneuver_strategy(
        time_to_tca=time_to_tca_hours,
        pre_miss=pre_maneuver_miss_dist_km,
        pc=collision_prob_pc,
        pass_conflict=target_pass_conflict_flag,
        fuel_avail=available_fuel_dv_ms,
        dv_T=dv_cost_prograde_ms,
        dv_N=dv_cost_normal_ms,
    )

    # Compute optimal burn delta-v
    optimal_burn_dv_ms = np.zeros(n, dtype=np.float64)
    cls0 = strategy == 0
    cls1 = strategy == 1
    cls2 = strategy == 2
    cls3 = strategy == 3

    optimal_burn_dv_ms[cls0] = dv_cost_prograde_ms[cls0]
    optimal_burn_dv_ms[cls1] = dv_cost_normal_ms[cls1]
    optimal_burn_dv_ms[cls2] = np.sqrt(dv_cost_prograde_ms[cls2]**2 + dv_cost_normal_ms[cls2]**2)
    optimal_burn_dv_ms[cls3] = 0.0

    active_mask = cls0 | cls1 | cls2
    optimal_burn_dv_ms[active_mask] = np.minimum(
        optimal_burn_dv_ms[active_mask], available_fuel_dv_ms[active_mask]
    )
    optimal_burn_dv_ms = np.clip(optimal_burn_dv_ms, 0.0, None)

    # Post-maneuver miss distance (guaranteed > 5.0 km for all active maneuvers)
    post_maneuver_miss_dist_km = np.copy(pre_maneuver_miss_dist_km)
    uplift = rng.uniform(0.5, 12.0, size=n)
    post_maneuver_miss_dist_km[active_mask] = 5.0 + uplift[active_mask]

    df = pd.DataFrame({
        "conjunction_id": conjunction_id,
        "active_sat_norad_id": active_sat_norad_id,
        "debris_norad_id": debris_norad_id,
        "time_to_tca_hours": np.round(time_to_tca_hours, 2),
        "pre_maneuver_miss_dist_km": np.round(pre_maneuver_miss_dist_km, 4),
        "relative_velocity_kms": np.round(relative_velocity_kms, 2),
        "collision_prob_pc": collision_prob_pc,
        "crossing_angle_deg": np.round(crossing_angle_deg, 2),
        "sat_altitude_km": np.round(sat_altitude_km, 2),
        "sat_inclination_deg": np.round(sat_inclination_deg, 2),
        "rel_pos_R_km": np.round(rel_pos_R_km, 4),
        "rel_pos_T_km": np.round(rel_pos_T_km, 4),
        "rel_pos_N_km": np.round(rel_pos_N_km, 4),
        "cov_sigma_T_m": np.round(cov_sigma_T_m, 1),
        "available_fuel_dv_ms": np.round(available_fuel_dv_ms, 3),
        "min_impulse_bit_ms": np.round(min_impulse_bit_ms, 4),
        "target_pass_conflict_flag": target_pass_conflict_flag,
        "mission_priority_tier": mission_priority_tier,
        "dv_cost_prograde_ms": np.round(dv_cost_prograde_ms, 4),
        "dv_cost_normal_ms": np.round(dv_cost_normal_ms, 4),
        "orbital_drift_penalty_km": np.round(orbital_drift_penalty_km, 4),
        "optimal_maneuver_strategy": strategy,
        "optimal_burn_dv_ms": np.round(optimal_burn_dv_ms, 4),
        "post_maneuver_miss_dist_km": np.round(post_maneuver_miss_dist_km, 4),
    })

    # Save to disk
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = DATA_DIR / "cam_scenarios_10k.csv"
    df.to_csv(csv_path, index=False)
    logger.info(f"Generated {len(df)} scenarios -> {csv_path}")
    return df


def run_dataset_generation(n: int = 10000) -> pd.DataFrame:
    """Entry point."""
    return generate_dataset(n_scenarios=n)
