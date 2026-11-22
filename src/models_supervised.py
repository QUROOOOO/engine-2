"""Step 4: XGBoost + PyTorch Deep MLP (Classification + Regression)."""

import numpy as np
import xgboost as xgb
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, mean_squared_error, r2_score
import json, logging, os, pickle
from pathlib import Path

logger = logging.getLogger(__name__)
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
OUTPUTS_DIR = Path(__file__).resolve().parent.parent / "outputs"

# Optional PyTorch import (e.g. for Google Colab / Linux / x86_64)
try:
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False
    torch = None
    nn = None


# ---------------------------------------------------------------------------
# Multi-Task MLP
# ---------------------------------------------------------------------------

if HAS_TORCH:
    class MultiTaskMLP(nn.Module):
        """Dual-head neural network for joint strategy classification + dv regression.

        Architecture
        ------------
        Shared backbone:
            Input → Linear(n_features, 256) → LayerNorm → SiLU →
            Linear(256, 128) → LayerNorm → SiLU →
            Linear(128, 64) → LayerNorm → SiLU

        Classification head:
            Linear(64, 32) → SiLU → Linear(32, 4)   (4 strategy classes)

        Regression head:
            Linear(64, 32) → SiLU → Linear(32, 1)   (optimal burn Δv in m/s)
        """

        def __init__(self, n_features: int):
            super().__init__()

            # Shared backbone
            self.backbone = nn.Sequential(
                nn.Linear(n_features, 256),
                nn.LayerNorm(256),
                nn.SiLU(),
                nn.Linear(256, 128),
                nn.LayerNorm(128),
                nn.SiLU(),
                nn.Linear(128, 64),
                nn.LayerNorm(64),
                nn.SiLU(),
            )

            # Classification head — 4 maneuver strategy classes
            self.cls_head = nn.Sequential(
                nn.Linear(64, 32),
                nn.SiLU(),
                nn.Linear(32, 4),
            )

            # Regression head — predicted burn Δv (m/s)
            self.reg_head = nn.Sequential(
                nn.Linear(64, 32),
                nn.SiLU(),
                nn.Linear(32, 1),
            )

        def forward(self, x: torch.Tensor):
            """Returns (class_logits [B, 4], dv_prediction [B, 1])."""
            shared = self.backbone(x)
            class_logits = self.cls_head(shared)
            dv_pred = self.reg_head(shared)
            return class_logits, dv_pred
else:
    class MultiTaskMLP:
        """Lightweight CPU-optimized Dual-Head MLP for ARM64 Windows environments."""
        def __init__(self, n_features: int):
            from sklearn.neural_network import MLPClassifier, MLPRegressor
            self.cls_model = MLPClassifier(
                hidden_layer_sizes=(256, 128, 64),
                activation='relu',
                solver='adam',
                max_iter=100,
                random_state=42,
                early_stopping=True,
            )
            self.reg_model = MLPRegressor(
                hidden_layer_sizes=(256, 128, 64),
                activation='relu',
                solver='adam',
                max_iter=100,
                random_state=42,
                early_stopping=True,
            )

        def fit(self, X, y_cls, y_reg):
            self.cls_model.fit(X, y_cls)
            self.reg_model.fit(X, y_reg)
            return self

        def predict(self, X):
            return self.cls_model.predict(X), self.reg_model.predict(X)


# ---------------------------------------------------------------------------
# Metrics helper
# ---------------------------------------------------------------------------

def _compute_metrics(y_cls_true: np.ndarray, y_cls_pred: np.ndarray,
                     y_reg_true: np.ndarray, y_reg_pred: np.ndarray) -> dict:
    """Compute standard classification + regression metrics."""
    acc = accuracy_score(y_cls_true, y_cls_pred)
    f1 = f1_score(y_cls_true, y_cls_pred, average="macro", zero_division=0)
    mae = mean_absolute_error(y_reg_true, y_reg_pred)
    rmse = float(np.sqrt(mean_squared_error(y_reg_true, y_reg_pred)))
    r2 = r2_score(y_reg_true, y_reg_pred) if len(y_reg_true) > 1 else 0.0
    return {
        "accuracy": round(float(acc), 6),
        "macro_f1": round(float(f1), 6),
        "mae_ms": round(float(mae), 6),
        "rmse_ms": round(float(rmse), 6),
        "r2": round(float(r2), 6),
    }


# ---------------------------------------------------------------------------
# XGBoost training
# ---------------------------------------------------------------------------

def train_xgboost(data: dict) -> dict:
    """Train XGBoost classifier and regressor.

    Classifier: XGBClassifier — multi:softprob, 4 classes, hist tree method.
    Regressor:  XGBRegressor  — reg:squarederror, hist tree method.

    Models saved to ``models/xgb_classifier.json`` and
    ``models/xgb_regressor.json``.

    Returns
    -------
    dict  — test-set metrics {accuracy, macro_f1, mae_ms, rmse_ms, r2}.
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    X_train = data["X_train"]
    X_test = data["X_test"]
    y_cls_train = data["y_cls_train"]
    y_cls_test = data["y_cls_test"]
    y_reg_train = data["y_reg_train"]
    y_reg_test = data["y_reg_test"]

    # ── Classifier ──────────────────────────────────────────────────────
    clf = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        tree_method="hist",
        objective="multi:softprob",
        num_class=4,
        eval_metric="mlogloss",
        verbosity=0,
        random_state=42,
    )
    clf.fit(
        X_train, y_cls_train,
        eval_set=[(X_test, y_cls_test)],
        verbose=False,
    )
    clf_path = MODELS_DIR / "xgb_classifier.json"
    clf.save_model(str(clf_path))
    logger.debug(f"  Saved XGB classifier → {clf_path}")

    y_cls_pred = clf.predict(X_test)

    # ── Regressor ───────────────────────────────────────────────────────
    reg = xgb.XGBRegressor(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        tree_method="hist",
        objective="reg:squarederror",
        eval_metric="rmse",
        verbosity=0,
        random_state=42,
    )
    reg.fit(
        X_train, y_reg_train,
        eval_set=[(X_test, y_reg_test)],
        verbose=False,
    )
    reg_path = MODELS_DIR / "xgb_regressor.json"
    reg.save_model(str(reg_path))
    logger.debug(f"  Saved XGB regressor → {reg_path}")

    y_reg_pred = reg.predict(X_test)

    return _compute_metrics(y_cls_test, y_cls_pred, y_reg_test, y_reg_pred)


# ---------------------------------------------------------------------------
# PyTorch MLP training (with ARM64 CPU-optimized fallback)
# ---------------------------------------------------------------------------

def train_pytorch_mlp(data: dict, epochs: int = 50, batch_size: int = 256,
                      lr: float = 1e-3) -> dict:
    """Train the MultiTaskMLP on CPU.

    Losses
    ------
    - Classification: CrossEntropyLoss
    - Regression: HuberLoss (delta=1.0)
    - Combined: cls_loss + 0.5 * reg_loss

    Optimizer: Adam, lr=1e-3.

    Model saved to ``models/multitask_mlp.pt``.

    Returns
    -------
    dict — test-set metrics {accuracy, macro_f1, mae_ms, rmse_ms, r2}.
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_path = MODELS_DIR / "multitask_mlp.pt"

    if HAS_TORCH:
        device = torch.device("cpu")

        # ── Prepare tensors ─────────────────────────────────────────────────
        X_train_t = torch.tensor(data["X_train"], dtype=torch.float32, device=device)
        y_cls_train_t = torch.tensor(data["y_cls_train"], dtype=torch.long, device=device)
        y_reg_train_t = torch.tensor(data["y_reg_train"], dtype=torch.float32, device=device).unsqueeze(1)

        X_test_t = torch.tensor(data["X_test"], dtype=torch.float32, device=device)
        y_cls_test_np = data["y_cls_test"]
        y_reg_test_np = data["y_reg_test"]

        train_ds = TensorDataset(X_train_t, y_cls_train_t, y_reg_train_t)
        train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True,
                                  drop_last=False)

        # ── Model, losses, optimizer ────────────────────────────────────────
        n_features = data["X_train"].shape[1]
        model = MultiTaskMLP(n_features).to(device)

        cls_criterion = nn.CrossEntropyLoss()
        reg_criterion = nn.HuberLoss(delta=1.0)
        optimizer = torch.optim.Adam(model.parameters(), lr=lr)

        # ── Training loop ───────────────────────────────────────────────────
        model.train()
        for epoch in range(epochs):
            epoch_loss = 0.0
            n_batches = 0
            for X_b, y_cls_b, y_reg_b in train_loader:
                optimizer.zero_grad()
                logits, dv_pred = model(X_b)
                loss_cls = cls_criterion(logits, y_cls_b)
                loss_reg = reg_criterion(dv_pred, y_reg_b)
                loss = loss_cls + 0.5 * loss_reg
                loss.backward()
                optimizer.step()
                epoch_loss += loss.item()
                n_batches += 1

            if (epoch + 1) % 10 == 0 or epoch == 0:
                avg = epoch_loss / max(n_batches, 1)
                logger.debug(f"    Epoch {epoch + 1:3d}/{epochs} — loss: {avg:.4f}")

        # ── Save model ──────────────────────────────────────────────────────
        torch.save({
            "model_state_dict": model.state_dict(),
            "n_features": n_features,
            "architecture": "MultiTaskMLP",
        }, str(model_path))
        logger.debug(f"  Saved MLP → {model_path}")

        # ── Evaluate on test set ────────────────────────────────────────────
        model.eval()
        with torch.no_grad():
            logits_test, dv_test = model(X_test_t)
            y_cls_pred = logits_test.argmax(dim=1).cpu().numpy()
            y_reg_pred = dv_test.squeeze(1).cpu().numpy()

        return _compute_metrics(y_cls_test_np, y_cls_pred, y_reg_test_np, y_reg_pred)
    else:
        # Fallback for Windows ARM64 CPU execution without torch wheel
        logger.info("  PyTorch not found on ARM64; utilizing vectorized CPU neural net MultiTaskMLP...")
        n_features = data["X_train"].shape[1]
        model = MultiTaskMLP(n_features)
        model.fit(data["X_train"], data["y_cls_train"], data["y_reg_train"])
        y_cls_pred, y_reg_pred = model.predict(data["X_test"])

        # Save model weights / checkpoint
        with open(model_path, "wb") as f:
            pickle.dump({"architecture": "MultiTaskMLP_CPU", "model": model, "n_features": n_features}, f)
        logger.debug(f"  Saved MultiTaskMLP checkpoint → {model_path}")

        return _compute_metrics(data["y_cls_test"], y_cls_pred, data["y_reg_test"], y_reg_pred)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run_supervised(data: dict) -> dict:
    """Train both models, compile metrics, save to outputs/benchmark_metrics.json.

    Returns
    -------
    dict — ``{'xgboost': {...}, 'pytorch_mlp': {...}}``.
    Target: Accuracy > 95 % for both models.
    """
    logger.info("Step 4: Training supervised models...")

    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

    xgb_metrics = train_xgboost(data)
    logger.info(f"  XGBoost — Acc: {xgb_metrics['accuracy']:.4f}, "
                f"F1: {xgb_metrics['macro_f1']:.4f}, "
                f"MAE: {xgb_metrics['mae_ms']:.4f} m/s")

    mlp_metrics = train_pytorch_mlp(data)
    logger.info(f"  PyTorch MLP — Acc: {mlp_metrics['accuracy']:.4f}, "
                f"F1: {mlp_metrics['macro_f1']:.4f}, "
                f"MAE: {mlp_metrics['mae_ms']:.4f} m/s")

    metrics = {"xgboost": xgb_metrics, "pytorch_mlp": mlp_metrics}

    # Persist metrics
    metrics_path = OUTPUTS_DIR / "benchmark_metrics.json"
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)
    logger.info(f"  Metrics saved → {metrics_path}")

    return metrics
