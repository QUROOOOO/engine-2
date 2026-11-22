# UC096 (QuantumOrbit) — Engine 2: Space Debris Collision Avoidance (CAM)

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-009688.svg)](https://fastapi.tiangolo.com)
[![XGBoost](https://img.shields.io/badge/XGBoost-2.0+-eb6100.svg)](https://xgboost.readthedocs.io)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.1+-ee4c2c.svg)](https://pytorch.org)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-0.29+-green.svg)](https://gymnasium.farama.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Engine 2 (CAM)** is the autonomous orbital collision avoidance and thruster burn optimization system for **UC096 (QuantumOrbit)**. When tracked high-velocity space debris approaches an active LEO satellite within critical threshold ($P_c > 10^{-4}$ or miss distance $< 5.0\text{ km}$), Engine 2 autonomously screens the conjunction and computes the smallest, safest 3D thruster burn ($\Delta v$ across Prograde/Retrograde Along-Track $\pm T$, Cross-Track Normal $\pm N$, or Radial $\pm R$ axes at an optimal lead time prior to Time of Closest Approach $TCA$). It guarantees a post-maneuver miss distance $> 5.0\text{ km}$ with minimal propellant expenditure ($\Delta v$) and zero disruption to scheduled Earth-observation imaging passes.

---

## 1. System Architecture

```text
                                LIVE ORBITAL INGESTION
                   CelesTrak API (Active Satellites & Debris Swarms)
                                          │
                                          ▼
                      SGP4 Orbit Propagator & RTN Screening
                          (72-hour Conjunction Screening)
                                          │
                                          ▼
                     CLOHESSY-WILTSHIRE (HILL'S) SIMULATOR
                        10,000 Scenarios × 24 Features
                   Foster 2D Gaussian Collision Probability (Pc)
                                          │
                                          ▼
                     HARD DETERMINISTIC SAFETY ACTION MASK
                Fuel Caps (dv <= avail_fuel) & Imaging Pass Lock
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
          SUPERVISED MODELS       REINFORCEMENT LEARNING   12-QUBIT QUBO vs MILP
        XGBoost (Hist Gradient)    Gymnasium Custom Env     Quantum-Inspired SA
        PyTorch Multi-Task MLP     Stable-Baselines3 PPO     SciPy HiGHS Solver
         (Accuracy: 99.75%)        (100% Safe, +32% Fuel)   (AR: 1.000, +75% Fuel)
                    │                     │                     │
                    └─────────────────────┼─────────────────────┘
                                          │
                                          ▼
                                MISSION CONTROL ENGINE
                          FastAPI REST Microservice & Three.js
                        Interactive 3D Mission Control Dashboard
```

---

## 2. 24-Column Conjunction Schema

The synthetic physics simulator (`src/dataset_generator.py`) generates a `10,000 × 24` dataset (`data/cam_scenarios_10k.csv`) adhering strictly to the following schema:

| # | Column Name | Type | Unit / Range | Description |
|---|-------------|------|--------------|-------------|
| **X1** | **Crisis Inputs (8 columns)** | | | |
| 1 | `conjunction_id` | `int` | $0 \dots 9999$ | Unique conjunction event identifier |
| 2 | `active_sat_norad_id` | `int` | ISRO Catalog IDs | Active satellite NORAD identifier (e.g. 43689) |
| 3 | `debris_norad_id` | `int` | $25000 \dots 40000$ | Space debris catalog identifier |
| 4 | `time_to_tca_hours` | `float` | $0.5 \dots 72.0\text{ h}$ | Lookahead time to Time of Closest Approach |
| 5 | `pre_maneuver_miss_dist_km` | `float` | $0.05 \dots 8.0\text{ km}$ | Unmitigated distance at TCA |
| 6 | `relative_velocity_kms` | `float` | $7.5 \dots 15.2\text{ km/s}$ | Relative orbital velocity vector magnitude |
| 7 | `collision_prob_pc` | `float` | $10^{-7} \dots 10^{-1}$ | Foster 2D Gaussian collision probability |
| 8 | `crossing_angle_deg` | `float` | $0.0^\circ \dots 180.0^\circ$ | Orbital plane intersection angle |
| **X2** | **Orbital & Fleet Constraints (10 columns)** | | | |
| 9 | `sat_altitude_km` | `float` | $450.0 \dots 850.0\text{ km}$ | Operational LEO orbital altitude |
| 10 | `sat_inclination_deg` | `float` | $50.0^\circ \dots 99.0^\circ$ | Orbital inclination angle |
| 11 | `rel_pos_R_km` | `float` | Radial offset | Radial coordinate in satellite RTN frame |
| 12 | `rel_pos_T_km` | `float` | Along-track offset | Along-track coordinate in satellite RTN frame |
| 13 | `rel_pos_N_km` | `float` | Cross-track offset | Out-of-plane normal coordinate in RTN frame |
| 14 | `cov_sigma_T_m` | `float` | $50.0 \dots 1500.0\text{ m}$ | 1-$\sigma$ along-track position uncertainty ellipsoid |
| 15 | `available_fuel_dv_ms` | `float` | $0.2 \dots 15.0\text{ m/s}$ | Remaining onboard propulsion propellant budget |
| 16 | `min_impulse_bit_ms` | `float` | $0.005 \dots 0.05\text{ m/s}$ | Minimum thruster impulse discretization bit |
| 17 | `target_pass_conflict_flag` | `int` | `0` or `1` | Scheduled Earth-observation optical camera lock |
| 18 | `mission_priority_tier` | `int` | $1, 2, 3$ | Priority tier of primary payload tasking |
| **X3** | **Physics Cost Inputs (3 columns)** | | | |
| 19 | `dv_cost_prograde_ms` | `float` | $\text{m/s}$ | Clohessy-Wiltshire along-track required burn |
| 20 | `dv_cost_normal_ms` | `float` | $\text{m/s}$ | CW out-of-plane cross-track required burn |
| 21 | `orbital_drift_penalty_km` | `float` | $\text{km}$ | Induced ground-track drift from secular phasing |
| **Y** | **Target Outputs (3 columns)** | | | |
| 22 | `optimal_maneuver_strategy` | `int` | $0, 1, 2, 3$ | Maneuver strategy class (see classes below) |
| 23 | `optimal_burn_dv_ms` | `float` | $\text{m/s}$ | Exact optimized thruster burn magnitude ($0.0$ for Class 3) |
| 24 | `post_maneuver_miss_dist_km` | `float` | $> 5.0\text{ km}$ | Clearance distance at TCA ($\ge 5.0\text{ km}$ guaranteed) |

### Maneuver Strategy Classes:
- **Class 0: Prograde/Retrograde Along-Track Phasing ($\pm T$)** — Lowest fuel cost when lead time $\ge 4.0\text{ h}$ and no camera imaging pass conflict.
- **Class 1: Cross-Track Normal Shift ($\pm N$)** — Mandatory when `target_pass_conflict_flag == 1` to prevent ground-track along-track drift.
- **Class 2: Hybrid Radial-Transverse Emergency Burn ($\pm R / \pm T$)** — Fast separation burn required for late alerts ($\text{lead time} < 4.0\text{ h}$).
- **Class 3: Hold / No-Burn Safe Pass** — Default when pre-maneuver miss $\ge 5.0\text{ km}$ and $P_c < 10^{-4}$, or fuel is depleted.

---

## 3. Verified Benchmark Results

The pipeline executes end-to-end on Windows ARM64 / CPU in **35.8 seconds** (target $< 3\text{ minutes}$):

| Model / Solver | Task | Accuracy | Macro-F1 | MAE ($\Delta v$) | Fuel Saved (%) | Safety Rate |
|----------------|------|----------|----------|-----------------|----------------|-------------|
| **XGBoost (Hist)** | Strategy & $\Delta v$ | **99.75%** | **0.9975** | **0.063 m/s** | — | **100.0%** |
| **PyTorch Deep MLP** | Dual-Head Multi-Task | **98.75%** | **0.9876** | **0.230 m/s** | — | **100.0%** |
| **PPO RL Agent** | Multi-Action Policy | — | — | — | **+32.1%** | **100.0%** |
| **12-Qubit QUBO (SA)** | Combinatorial Schedule | **AR: 1.000** | — | — | **+75.0%** | **100.0%** |
| **SciPy HiGHS MILP** | Exact Ground Truth | **Optimal** | — | — | **+75.0%** | **100.0%** |

*All active maneuvers achieve 100% collision-free post-maneuver separation ($> 5.0\text{ km}$).*

---

## 4. Repository Structure

```text
D:\hackathons\Random\
├── data/
│   ├── tles/                             # Cached CelesTrak TLEs + synthetic fallbacks
│   ├── cam_scenarios_10k.csv             # Generated 10,000 × 24 benchmark dataset
│   └── sample_conjunction_io.json        # Shared team JSON input/output schema
├── models/                               # Saved XGBoost (.json), MLP (.pt), and SB3 PPO (.zip)
├── outputs/
│   ├── mission_control.html              # Standalone 3D Three.js Mission Control UI
│   ├── benchmark_metrics.json            # Final metrics JSON
│   ├── qubo_milp_results.json            # Detailed QUBO vs MILP benchmark results
│   └── plots/
│       ├── 1_3d_conjunction_dodge_trajectory.png (& .html)
│       ├── 2_uncertainty_ellipsoid_pc_heatmap.png
│       └── 3_model_benchmarks_and_fuel_saved.png (& .html)
├── notebooks/
│   └── UC096_Engine2_CAM_Colab.ipynb     # Self-contained Google Colab notebook
├── src/
│   ├── __init__.py
│   ├── ingestion.py                      # Step 1: CelesTrak fetcher & SGP4 propagator
│   ├── dataset_generator.py              # Step 2: 10k Clohessy-Wiltshire physics simulator
│   ├── preprocessing.py                  # Step 3: Feature scaling & safety masking
│   ├── models_supervised.py              # Step 4: XGBoost + PyTorch Deep MLP
│   ├── models_rl.py                      # Step 5A: Gymnasium Env + PPO Agent
│   ├── solver_qubo_milp.py               # Step 5B: 12-Qubit QUBO vs SciPy HiGHS MILP
│   ├── visuals.py                        # Step 6: Dark-slate 3D & 2D visualizations
│   └── api.py                            # FastAPI microservice & 3D Mission Control
├── main.py                               # Master end-to-end orchestrator
├── requirements.txt                      # Project dependencies
└── README.md
```

---

## 5. Quickstart & Installation

### Prerequisites
- Python 3.10+ (supports Windows ARM64, Linux, macOS, and Google Colab)

### Setup & Run
```bash
# Clone the repository
git clone https://github.com/Krish-tec/engine-2.git
cd engine-2

# Install dependencies
pip install -r requirements.txt

# Run the master pipeline end-to-end (Steps 1-6)
python main.py
```

### Start the 3D Mission Control API Server
```bash
uvicorn src.api:app --host 0.0.0.0 --port 8000 --reload
```
Open **[http://localhost:8000](http://localhost:8000)** in your browser to interact with the 3D Three.js Mission Control dashboard!

---

## 6. FastAPI Microservice Endpoints

### 1. Liveness & Readiness Probe
`GET /health`
```json
{
  "status": "healthy",
  "engine": "Engine2-CAM",
  "version": "1.0.0"
}
```

### 2. Autonomous Collision Avoidance Optimization
`POST /api/v1/engine2/optimize-maneuver`

**Sample Request Payload:**
```json
{
  "conjunction_id": 42,
  "active_sat_norad_id": 43689,
  "debris_norad_id": 34127,
  "time_to_tca_hours": 8.5,
  "pre_maneuver_miss_dist_km": 1.23,
  "relative_velocity_kms": 12.4,
  "collision_prob_pc": 0.0032,
  "crossing_angle_deg": 67.8,
  "sat_altitude_km": 620.0,
  "sat_inclination_deg": 97.4,
  "rel_pos_R_km": 0.35,
  "rel_pos_T_km": -0.92,
  "rel_pos_N_km": 0.18,
  "cov_sigma_T_m": 450.0,
  "available_fuel_dv_ms": 5.0,
  "min_impulse_bit_ms": 0.01,
  "target_pass_conflict_flag": 0,
  "mission_priority_tier": 1
}
```

**Sample Response Payload:**
```json
{
  "conjunction_id": 42,
  "optimal_maneuver_strategy": 0,
  "optimal_maneuver_label": "Prograde/Retrograde Along-Track Phasing (±T)",
  "optimal_burn_dv_ms": 1.9135,
  "burn_axis": "Along-Track (±T)",
  "lead_time_hours": 5.1,
  "post_maneuver_miss_dist_km": 5.0,
  "collision_prob_pre": 0.0032,
  "collision_prob_post": 2.08e-27,
  "fuel_remaining_dv_ms": 3.0865,
  "orbital_drift_penalty_km": 3.5433,
  "qubo_approximation_ratio": 0.9742,
  "safety_verified": true,
  "alert_level": "CRITICAL"
}
```

### 3. Retrieve Latest Benchmark Metrics
`GET /api/v1/engine2/benchmark`
Returns the verified benchmark metrics across XGBoost, PyTorch MLP, PPO RL, and QUBO/MILP solvers.

---

## 7. Interactive 3D Mission Control UI

The included Mission Control UI (`outputs/mission_control.html` or `http://localhost:8000/`) features:
1. **Interactive 3D Three.js Viewport**: Real-time rendering of active LEO satellites, incoming debris trajectories, red 5.0 km wireframe exclusion spheres, and evasive burn vectors.
2. **Crisis Telemetry HUD**: Live countdown to TCA, miss distance alarms, Foster collision probability, and relative velocity.
3. **Autonomous Maneuver Command Center**: Instantaneous calculation of optimal burn axis ($\pm T, \pm N, \pm R$) and propellant budget remaining.
4. **Interactive Parameter Testing**: Real-time parameter sliders allowing flight dynamics officers to simulate crisis events and invoke Engine 2's backend live.

---

## 8. License
Developed for **UC096 (QuantumOrbit)**. Distributed under the MIT License.

