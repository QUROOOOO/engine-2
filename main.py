#!/usr/bin/env python3
"""
UC096 Engine 2 — Space Debris Collision Avoidance (CAM)
Master Orchestrator: runs Steps 1-6 end-to-end.

Usage:
    python main.py              # Full pipeline
    python main.py --skip-tle   # Skip live TLE fetch (use synthetic data only)
"""

import sys
import os
import json
import time
import logging
import argparse
from pathlib import Path

# ── Configure logging ───────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(levelname)-7s │ %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("Engine2-CAM")

# ── Paths ───────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
MODELS_DIR = ROOT / "models"
OUTPUTS_DIR = ROOT / "outputs"
PLOTS_DIR = OUTPUTS_DIR / "plots"

for d in [DATA_DIR, DATA_DIR / "tles", MODELS_DIR, OUTPUTS_DIR, PLOTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ── Expose FastAPI ASGI App (for Vercel & ASGI runners) ─────────────────
try:
    from src.api import app
except Exception:
    app = None


def main():
    parser = argparse.ArgumentParser(description="UC096 Engine 2 CAM Pipeline")
    parser.add_argument("--skip-tle", action="store_true", help="Skip live TLE fetch")
    parser.add_argument("--scenarios", type=int, default=10000, help="Number of scenarios")
    args = parser.parse_args()

    t0 = time.perf_counter()
    all_metrics = {}

    # ════════════════════════════════════════════════════════════════════
    # STEP 1: Live API Ingestion & SGP4 Propagation
    # ════════════════════════════════════════════════════════════════════
    logger.info("=" * 70)
    logger.info("STEP 1: TLE Ingestion & SGP4 Propagation")
    logger.info("=" * 70)
    try:
        from src.ingestion import run_ingestion
        conjunctions = run_ingestion()
        logger.info(f"  ✓ Ingestion complete — {len(conjunctions)} conjunctions found")
    except Exception as e:
        logger.warning(f"  ⚠ Ingestion encountered issues: {e}")
        logger.info("  → Proceeding with synthetic dataset generation")
        conjunctions = []

    # ════════════════════════════════════════════════════════════════════
    # STEP 2: 10,000-Scenario Physics Dataset Generation
    # ════════════════════════════════════════════════════════════════════
    logger.info("=" * 70)
    logger.info(f"STEP 2: Generating {args.scenarios} CW Physics Scenarios")
    logger.info("=" * 70)
    from src.dataset_generator import run_dataset_generation
    df = run_dataset_generation(n=args.scenarios)
    logger.info(f"  ✓ Dataset: {df.shape[0]} rows × {df.shape[1]} columns")
    logger.info(f"  ✓ Class distribution: {df['optimal_maneuver_strategy'].value_counts().to_dict()}")

    # Validate safety constraint
    active_mask = df["optimal_maneuver_strategy"] != 3
    post_miss = df.loc[active_mask, "post_maneuver_miss_dist_km"]
    safe_rate = (post_miss > 5.0).mean()
    logger.info(f"  ✓ Post-maneuver safe rate (active burns): {safe_rate:.2%}")
    assert safe_rate == 1.0, f"SAFETY VIOLATION: {(1 - safe_rate)*100:.1f}% of active maneuvers have post_miss < 5.0 km"

    # ════════════════════════════════════════════════════════════════════
    # STEP 3: Preprocessing & Hard Safety Masking
    # ════════════════════════════════════════════════════════════════════
    logger.info("=" * 70)
    logger.info("STEP 3: Preprocessing & Safety Masking")
    logger.info("=" * 70)
    from src.preprocessing import run_preprocessing
    data = run_preprocessing(df)
    logger.info(f"  ✓ Train: {data['X_train'].shape}, Test: {data['X_test'].shape}")

    # ════════════════════════════════════════════════════════════════════
    # STEP 4: Supervised Learning (XGBoost + PyTorch MLP)
    # ════════════════════════════════════════════════════════════════════
    logger.info("=" * 70)
    logger.info("STEP 4: Training Supervised Models")
    logger.info("=" * 70)
    from src.models_supervised import run_supervised
    sup_metrics = run_supervised(data)
    all_metrics.update(sup_metrics)

    for name, m in sup_metrics.items():
        logger.info(f"  ✓ {name}: Acc={m['accuracy']:.4f}, F1={m['macro_f1']:.4f}, "
                     f"MAE={m['mae_ms']:.4f} m/s, RMSE={m['rmse_ms']:.4f} m/s")

    # ════════════════════════════════════════════════════════════════════
    # STEP 5A: Reinforcement Learning (PPO)
    # ════════════════════════════════════════════════════════════════════
    logger.info("=" * 70)
    logger.info("STEP 5A: Training RL Agent (PPO)")
    logger.info("=" * 70)
    from src.models_rl import run_rl
    rl_metrics = run_rl(data)
    all_metrics["ppo_rl"] = rl_metrics
    logger.info(f"  ✓ PPO: Safe Rate={rl_metrics['safe_rate']:.2%}, "
                 f"Fuel Saved={rl_metrics['fuel_saved_pct']:.1f}%")

    # ════════════════════════════════════════════════════════════════════
    # STEP 5B: QUBO / MILP Solvers
    # ════════════════════════════════════════════════════════════════════
    logger.info("=" * 70)
    logger.info("STEP 5B: QUBO (Simulated Annealing) vs MILP (HiGHS)")
    logger.info("=" * 70)
    from src.solver_qubo_milp import run_qubo_milp
    qubo_metrics = run_qubo_milp(data)
    all_metrics["qubo_milp"] = qubo_metrics
    logger.info(f"  ✓ QUBO AR: {qubo_metrics['approximation_ratio']:.4f}, "
                 f"Fuel Saved: {qubo_metrics['fuel_saved_vs_greedy_pct']:.1f}%")

    # ════════════════════════════════════════════════════════════════════
    # STEP 6: Visualizations
    # ════════════════════════════════════════════════════════════════════
    logger.info("=" * 70)
    logger.info("STEP 6: Generating Dark-Slate Visualizations")
    logger.info("=" * 70)
    from src.visuals import run_visuals
    run_visuals(all_metrics)

    # ════════════════════════════════════════════════════════════════════
    # Save Final Benchmark Metrics
    # ════════════════════════════════════════════════════════════════════
    metrics_path = OUTPUTS_DIR / "benchmark_metrics.json"
    # Convert any numpy types for JSON serialization
    def _convert(obj):
        import numpy as np
        if isinstance(obj, (np.integer,)):
            return int(obj)
        elif isinstance(obj, (np.floating,)):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, dict):
            return {k: _convert(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [_convert(v) for v in obj]
        return obj

    serializable_metrics = _convert(all_metrics)
    with open(metrics_path, "w") as f:
        json.dump(serializable_metrics, f, indent=2)
    logger.info(f"  ✓ Metrics saved to {metrics_path}")

    # ════════════════════════════════════════════════════════════════════
    # Summary
    # ════════════════════════════════════════════════════════════════════
    elapsed = time.perf_counter() - t0
    logger.info("=" * 70)
    logger.info("PIPELINE COMPLETE")
    logger.info("=" * 70)
    logger.info(f"  Total time: {elapsed:.1f}s ({elapsed/60:.1f} min)")
    logger.info(f"  Dataset: {df.shape[0]} scenarios × {df.shape[1]} features")
    logger.info(f"  Models trained: XGBoost, PyTorch MLP, PPO RL")
    logger.info(f"  Solvers: QUBO SA + MILP HiGHS")
    logger.info(f"  Plots: {len(list(PLOTS_DIR.glob('*.png')))} PNG + "
                 f"{len(list(PLOTS_DIR.glob('*.html')))} HTML")
    logger.info(f"  Post-maneuver safety rate: 100%")

    # Print key metrics table
    logger.info("")
    logger.info(f"  {'Model':<18} {'Accuracy':<10} {'F1':<10} {'MAE(m/s)':<10} {'Fuel Saved%':<12}")
    logger.info(f"  {'─' * 60}")
    if "xgboost" in all_metrics:
        m = all_metrics["xgboost"]
        logger.info(f"  {'XGBoost':<18} {m.get('accuracy', '-'):<10.4f} {m.get('macro_f1', '-'):<10.4f} "
                     f"{m.get('mae_ms', '-'):<10.4f} {'—':<12}")
    if "pytorch_mlp" in all_metrics:
        m = all_metrics["pytorch_mlp"]
        logger.info(f"  {'PyTorch MLP':<18} {m.get('accuracy', '-'):<10.4f} {m.get('macro_f1', '-'):<10.4f} "
                     f"{m.get('mae_ms', '-'):<10.4f} {'—':<12}")
    if "ppo_rl" in all_metrics:
        m = all_metrics["ppo_rl"]
        logger.info(f"  {'PPO RL':<18} {'—':<10} {'—':<10} {'—':<10} "
                     f"{m.get('fuel_saved_pct', 0):<12.1f}")
    if "qubo_milp" in all_metrics:
        m = all_metrics["qubo_milp"]
        ar = m.get('approximation_ratio', 0)
        fs = m.get('fuel_saved_vs_greedy_pct', 0)
        logger.info(f"  {'QUBO/MILP':<18} {'—':<10} {'—':<10} {'—':<10} {fs:<12.1f}")
        logger.info(f"  QUBO Approximation Ratio: {ar:.4f}")

    return all_metrics


if __name__ == "__main__":
    main()

