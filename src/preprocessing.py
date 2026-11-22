"""Step 3: Feature scaling & hard safety constraint masking."""

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from pathlib import Path
import logging, json

logger = logging.getLogger(__name__)

# Feature column groups
FEATURE_COLS = [
    "time_to_tca_hours", "pre_maneuver_miss_dist_km", "relative_velocity_kms",
    "collision_prob_pc", "crossing_angle_deg", "sat_altitude_km", "sat_inclination_deg",
    "rel_pos_R_km", "rel_pos_T_km", "rel_pos_N_km", "cov_sigma_T_m",
    "available_fuel_dv_ms", "min_impulse_bit_ms", "target_pass_conflict_flag",
    "mission_priority_tier", "dv_cost_prograde_ms", "dv_cost_normal_ms",
    "orbital_drift_penalty_km",
]
CLASSIFICATION_TARGET = "optimal_maneuver_strategy"
REGRESSION_TARGET = "optimal_burn_dv_ms"
SAFETY_TARGET = "post_maneuver_miss_dist_km"


def load_dataset(csv_path: str = None) -> pd.DataFrame:
    """Load cam_scenarios_10k.csv from data/ directory."""
    if csv_path is None:
        csv_path = Path(__file__).resolve().parent.parent / "data" / "cam_scenarios_10k.csv"
    csv_path = Path(csv_path)
    if not csv_path.exists():
        raise FileNotFoundError(f"Dataset not found at {csv_path}")
    df = pd.read_csv(csv_path)
    if df.empty:
        raise ValueError("Dataset is empty")
    return df


def safety_action_mask(df: pd.DataFrame) -> np.ndarray:
    """Create a deterministic safety mask (N x 4) boolean array.

    For each scenario, mask[i, c] = True means class c is ALLOWED.

    Rules:
    - Class 0 (Along-Track): blocked if dv_cost_prograde_ms > available_fuel_dv_ms
    - Class 1 (Cross-Track): blocked if dv_cost_normal_ms > available_fuel_dv_ms
    - Class 2 (Hybrid Emergency): blocked if max(dv_cost_prograde_ms*0.7,
      dv_cost_normal_ms*0.7) > available_fuel_dv_ms
    - Class 3 (Hold): always allowed (no burn = always feasible)
    - If target_pass_conflict_flag == 1, penalize class 0 (allow but mark as
      suboptimal — we keep it allowed since downstream models handle penalties)

    Returns boolean mask array of shape (N, 4).
    """
    n = len(df)
    if n == 0:
        return np.empty((0, 4), dtype=bool)

    fuel = df["available_fuel_dv_ms"].values.astype(np.float64)
    dv_pro = df["dv_cost_prograde_ms"].values.astype(np.float64)
    dv_norm = df["dv_cost_normal_ms"].values.astype(np.float64)

    mask = np.ones((n, 4), dtype=bool)

    # Class 0 — Along-Track: blocked when prograde cost exceeds fuel budget
    mask[:, 0] = dv_pro <= fuel

    # Class 1 — Cross-Track: blocked when normal cost exceeds fuel budget
    mask[:, 1] = dv_norm <= fuel

    # Class 2 — Hybrid Emergency: uses 70 % of both components
    hybrid_cost = np.maximum(dv_pro * 0.7, dv_norm * 0.7)
    mask[:, 2] = hybrid_cost <= fuel

    # Class 3 — Hold: always feasible (already True)

    # Safety: ensure at least class 3 (Hold) is always available — it already is,
    # but double-check for defensive programming.
    mask[:, 3] = True

    return mask


def preprocess(df: pd.DataFrame, test_size: float = 0.2, seed: int = 42) -> dict:
    """Full preprocessing pipeline.

    1. Extract features (FEATURE_COLS) and targets
    2. Split 80/20 train/test stratified by optimal_maneuver_strategy
    3. StandardScaler fit on train, transform both
    4. Compute safety_action_mask for both sets
    5. Return dict with all arrays, scaler, feature names, and original DataFrames.
    """
    if df.empty:
        raise ValueError("Cannot preprocess an empty DataFrame")

    # ── 0. Validate required columns ────────────────────────────────────
    missing_feat = [c for c in FEATURE_COLS if c not in df.columns]
    if missing_feat:
        raise KeyError(f"Missing feature columns: {missing_feat}")
    for tgt in (CLASSIFICATION_TARGET, REGRESSION_TARGET, SAFETY_TARGET):
        if tgt not in df.columns:
            raise KeyError(f"Missing target column: {tgt}")

    # ── 1. Extract features & targets ───────────────────────────────────
    X = df[FEATURE_COLS].copy()
    y_cls = df[CLASSIFICATION_TARGET].values.astype(np.int64)
    y_reg = df[REGRESSION_TARGET].values.astype(np.float64)
    y_safety = df[SAFETY_TARGET].values.astype(np.float64)

    # Handle any NaN / inf in features — fill with column median
    if X.isnull().any().any():
        logger.warning("NaN values detected in features — filling with column median")
        X = X.fillna(X.median())
    X = X.replace([np.inf, -np.inf], np.nan).fillna(0.0)

    # ── 2. Stratified train / test split ────────────────────────────────
    indices = np.arange(len(df))
    idx_train, idx_test = train_test_split(
        indices,
        test_size=test_size,
        random_state=seed,
        stratify=y_cls,
    )

    X_train_raw = X.iloc[idx_train].values.astype(np.float64)
    X_test_raw = X.iloc[idx_test].values.astype(np.float64)

    y_cls_train = y_cls[idx_train]
    y_cls_test = y_cls[idx_test]
    y_reg_train = y_reg[idx_train]
    y_reg_test = y_reg[idx_test]
    y_safety_train = y_safety[idx_train]
    y_safety_test = y_safety[idx_test]

    df_train = df.iloc[idx_train].reset_index(drop=True)
    df_test = df.iloc[idx_test].reset_index(drop=True)

    # ── 3. Standard scaling ─────────────────────────────────────────────
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train_raw)
    X_test = scaler.transform(X_test_raw)

    # ── 4. Safety action masks ──────────────────────────────────────────
    mask_train = safety_action_mask(df_train)
    mask_test = safety_action_mask(df_test)

    return {
        "X_train": X_train,
        "X_test": X_test,
        "y_cls_train": y_cls_train,
        "y_cls_test": y_cls_test,
        "y_reg_train": y_reg_train,
        "y_reg_test": y_reg_test,
        "y_safety_train": y_safety_train,
        "y_safety_test": y_safety_test,
        "mask_train": mask_train,
        "mask_test": mask_test,
        "scaler": scaler,
        "feature_names": list(FEATURE_COLS),
        "df_train": df_train,
        "df_test": df_test,
    }


def run_preprocessing(df: pd.DataFrame = None) -> dict:
    """Entry point. Load data if needed, preprocess, return dict."""
    logger.info("Step 3: Preprocessing & safety masking...")
    if df is None:
        df = load_dataset()
    data = preprocess(df)
    logger.info(f"  Train: {data['X_train'].shape[0]}, Test: {data['X_test'].shape[0]}")
    logger.info(f"  Class distribution (train): {np.bincount(data['y_cls_train'], minlength=4)}")
    logger.info(f"  Safety mask — allowed actions per class (train mean): "
                f"{data['mask_train'].mean(axis=0).round(3)}")
    return data
