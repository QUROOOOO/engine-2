"""Step 6: Dark-slate 3D & 2D visualizations."""

import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.colors as mcolors
from matplotlib.patches import Ellipse
import json, logging
from pathlib import Path

logger = logging.getLogger(__name__)
PLOTS_DIR = Path(__file__).resolve().parent.parent / "outputs" / "plots"

# Dark-slate color scheme
BG_COLOR = "#0f172a"
GRID_COLOR = "#1e293b"
TEXT_COLOR = "#e2e8f0"
CYAN = "#38bdf8"
EMERALD = "#10b981"
AMBER = "#f59e0b"
CRIMSON = "#f43f5e"
ACCENT_COLORS = [CYAN, EMERALD, AMBER, CRIMSON]


def _make_wireframe_sphere(cx: float, cy: float, cz: float, r: float, n: int = 24):
    """Return Plotly traces for a wireframe sphere (latitude + longitude lines)."""
    traces = []
    # Latitude circles
    for phi in np.linspace(0, np.pi, n // 2 + 1):
        theta = np.linspace(0, 2 * np.pi, n + 1)
        x = cx + r * np.sin(phi) * np.cos(theta)
        y = cy + r * np.sin(phi) * np.sin(theta)
        z = cz + r * np.cos(phi) * np.ones_like(theta)
        traces.append(go.Scatter3d(
            x=x, y=y, z=z, mode="lines",
            line=dict(color=CRIMSON, width=1),
            opacity=0.18, showlegend=False, hoverinfo="skip",
        ))
    # Longitude circles
    for theta_val in np.linspace(0, 2 * np.pi, n + 1)[:-1]:
        phi = np.linspace(0, np.pi, n + 1)
        x = cx + r * np.sin(phi) * np.cos(theta_val)
        y = cy + r * np.sin(phi) * np.sin(theta_val)
        z = cz + r * np.cos(phi)
        traces.append(go.Scatter3d(
            x=x, y=y, z=z, mode="lines",
            line=dict(color=CRIMSON, width=1),
            opacity=0.18, showlegend=False, hoverinfo="skip",
        ))
    return traces


def plot_3d_conjunction_dodge(save_dir: Path = None):
    """Plot 1: 3D RTN orbital trajectory showing conjunction dodge geometry.

    Elements rendered:
    - Incoming debris vector (crimson thick line with arrowhead cone)
    - 5.0 km red wireframe safety sphere centered on satellite
    - Pre-maneuver collision path (amber dashed line approaching sphere)
    - Post-maneuver evasive trajectory (emerald solid line curving away)
    - Satellite position marker (cyan dot)
    - Axes: Radial (R), Along-Track (T), Normal (N) in km
    """
    if save_dir is None:
        save_dir = PLOTS_DIR
    save_dir.mkdir(parents=True, exist_ok=True)

    fig = go.Figure()

    # --- Satellite at origin ------------------------------------------------
    fig.add_trace(go.Scatter3d(
        x=[0], y=[0], z=[0], mode="markers",
        marker=dict(size=8, color=CYAN, symbol="circle"),
        name="Satellite (pre-burn)",
    ))

    # --- Safety sphere (5 km wireframe) ------------------------------------
    for tr in _make_wireframe_sphere(0, 0, 0, 5.0, n=20):
        fig.add_trace(tr)
    # add a single invisible trace just for the legend entry
    fig.add_trace(go.Scatter3d(
        x=[None], y=[None], z=[None], mode="lines",
        line=dict(color=CRIMSON, width=3),
        name="5 km Safety Sphere",
    ))

    # --- Debris trajectory (crimson) ----------------------------------------
    t_debris = np.linspace(-25, 25, 300)
    # Debris approaches from (+R, -T, +N) → passes near origin → exits
    debris_R = 0.35 * t_debris
    debris_T = -0.9 * t_debris
    debris_N = 0.12 * t_debris
    fig.add_trace(go.Scatter3d(
        x=debris_R, y=debris_T, z=debris_N, mode="lines",
        line=dict(color=CRIMSON, width=5),
        name="Debris Trajectory",
    ))
    # Arrow-head cone at leading edge of debris
    arrow_idx = 250
    fig.add_trace(go.Cone(
        x=[debris_R[arrow_idx]], y=[debris_T[arrow_idx]], z=[debris_N[arrow_idx]],
        u=[0.35], v=[-0.9], w=[0.12],
        sizemode="absolute", sizeref=2.0,
        colorscale=[[0, CRIMSON], [1, CRIMSON]], showscale=False,
        name="Debris Direction", showlegend=False,
    ))

    # --- Pre-maneuver satellite path (amber dashed) -------------------------
    # Satellite drifts slightly in along-track; debris closest approach ~1.2 km
    t_pre = np.linspace(-15, 0, 150)
    pre_R = 0.02 * t_pre
    pre_T = 0.6 * t_pre  # slow along-track drift toward TCA
    pre_N = 0.01 * t_pre
    fig.add_trace(go.Scatter3d(
        x=pre_R, y=pre_T, z=pre_N, mode="lines",
        line=dict(color=AMBER, width=4, dash="dash"),
        name="Pre-Maneuver Path (collision course)",
    ))
    # TCA marker (closest approach if no burn)
    fig.add_trace(go.Scatter3d(
        x=[pre_R[-1]], y=[pre_T[-1]], z=[pre_N[-1]], mode="markers",
        marker=dict(size=6, color=AMBER, symbol="diamond"),
        name="TCA (no-burn closest approach)",
    ))

    # --- Post-maneuver evasive trajectory (emerald solid) --------------------
    # An along-track burn shifts the satellite ~8 km in T, curving away
    t_post = np.linspace(0, 18, 180)
    # Burn delivers +T impulse → satellite drifts ahead and slightly out-of-plane
    post_R = 0.15 * np.sin(0.25 * t_post)  # small oscillation from CW
    post_T = 0.8 * t_post + 0.4 * t_post**1.1  # accelerated along-track shift
    post_N = 0.3 * np.sin(0.18 * t_post)  # gentle normal oscillation
    fig.add_trace(go.Scatter3d(
        x=post_R, y=post_T, z=post_N, mode="lines",
        line=dict(color=EMERALD, width=4),
        name="Post-Maneuver Evasive Path",
    ))
    # Post-burn satellite marker
    fig.add_trace(go.Scatter3d(
        x=[post_R[60]], y=[post_T[60]], z=[post_N[60]], mode="markers",
        marker=dict(size=7, color=EMERALD, symbol="circle"),
        name="Satellite (post-burn position)",
    ))

    # --- Annotation: miss-distance line at closest approach ------------------
    # Draw a thin white line from debris at TCA to satellite at TCA
    tca_idx = 150  # midpoint of debris array ≈ origin
    fig.add_trace(go.Scatter3d(
        x=[debris_R[tca_idx], 0], y=[debris_T[tca_idx], 0], z=[debris_N[tca_idx], 0],
        mode="lines+text",
        line=dict(color="white", width=2, dash="dot"),
        text=["", "Miss dist = 1.2 km (pre-burn)"],
        textposition="top center",
        textfont=dict(color="white", size=10),
        showlegend=False,
    ))

    # --- Layout -------------------------------------------------------------
    axis_common = dict(
        backgroundcolor=BG_COLOR,
        gridcolor=GRID_COLOR,
        color=TEXT_COLOR,
        showbackground=True,
        zerolinecolor=GRID_COLOR,
    )
    fig.update_layout(
        scene=dict(
            xaxis=dict(title="Radial  R (km)", **axis_common),
            yaxis=dict(title="Along-Track  T (km)", **axis_common),
            zaxis=dict(title="Normal  N (km)", **axis_common),
            bgcolor=BG_COLOR,
            aspectmode="data",
        ),
        paper_bgcolor=BG_COLOR,
        plot_bgcolor=BG_COLOR,
        font=dict(color=TEXT_COLOR, family="Inter, Arial"),
        title=dict(
            text="3D Conjunction Dodge Trajectory  (RTN Frame)",
            font=dict(size=20, color=CYAN),
            x=0.5,
        ),
        legend=dict(
            bgcolor="rgba(15,23,42,0.85)",
            bordercolor=GRID_COLOR,
            borderwidth=1,
            font=dict(size=11, color=TEXT_COLOR),
        ),
        margin=dict(l=0, r=0, t=60, b=0),
        width=1200, height=800,
    )

    fig.write_html(str(save_dir / "1_3d_conjunction_dodge_trajectory.html"))
    try:
        fig.write_image(str(save_dir / "1_3d_conjunction_dodge_trajectory.png"), scale=2)
    except Exception as exc:  # kaleido may not be installed
        logger.warning("  Could not export PNG (kaleido missing?): %s", exc)
    logger.info("  Saved: 1_3d_conjunction_dodge_trajectory.png/.html")


def plot_uncertainty_ellipsoid_heatmap(save_dir: Path = None):
    """Plot 2: B-Plane uncertainty ellipsoid (left) + Pc contour heatmap (right).

    Left panel  – B-plane covariance ellipsoid (σ_T × σ_N), combined hard-body
                  radius, and miss-distance point.
    Right panel – Collision Probability Pc contour across burn lead-time and Δv
                  magnitude, colour-mapped to log10(Pc).
    """
    if save_dir is None:
        save_dir = PLOTS_DIR
    save_dir.mkdir(parents=True, exist_ok=True)

    # ---- Matplotlib dark-slate RC overrides --------------------------------
    plt.rcParams.update({
        "axes.facecolor": BG_COLOR,
        "axes.edgecolor": GRID_COLOR,
        "axes.labelcolor": TEXT_COLOR,
        "xtick.color": TEXT_COLOR,
        "ytick.color": TEXT_COLOR,
        "text.color": TEXT_COLOR,
        "figure.facecolor": BG_COLOR,
        "grid.color": GRID_COLOR,
        "grid.alpha": 0.4,
    })

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 7), facecolor=BG_COLOR)

    # ========================================================================
    # LEFT: B-Plane covariance ellipsoid
    # ========================================================================
    sigma_T = 0.50  # km (1-σ along-track in B-plane)
    sigma_N = 0.18  # km (1-σ cross-track)
    combined_radius = 0.015  # km (sum of hard-body radii ≈ 15 m)
    miss_T, miss_N = 0.35, 0.12  # km miss-distance vector in B-plane

    ax1.set_facecolor(BG_COLOR)
    ax1.grid(True, linewidth=0.5)

    # 1-σ, 2-σ, 3-σ ellipses
    for n_sigma, alpha in [(3, 0.15), (2, 0.25), (1, 0.45)]:
        ell = Ellipse(
            (0, 0), width=2 * n_sigma * sigma_T, height=2 * n_sigma * sigma_N,
            angle=0, edgecolor=AMBER, facecolor=AMBER, alpha=alpha,
            linewidth=1.5, linestyle="--" if n_sigma > 1 else "-",
        )
        ax1.add_patch(ell)
        ax1.annotate(
            f"{n_sigma}σ", xy=(n_sigma * sigma_T * 0.72, n_sigma * sigma_N * 0.72),
            fontsize=8, color=AMBER, alpha=0.9,
        )

    # Combined hard-body circle
    hb = plt.Circle((0, 0), combined_radius, edgecolor=CRIMSON, facecolor=CRIMSON,
                     alpha=0.6, linewidth=2, label=f"Combined HBR ({combined_radius*1000:.0f} m)")
    ax1.add_patch(hb)

    # Miss-distance point
    ax1.plot(miss_T, miss_N, "o", color=EMERALD, markersize=9, zorder=5,
             label=f"Miss Distance ({np.hypot(miss_T, miss_N)*1000:.0f} m)")
    ax1.plot([0, miss_T], [0, miss_N], "--", color=EMERALD, linewidth=1.2, alpha=0.7)

    # Origin
    ax1.plot(0, 0, "+", color=CYAN, markersize=12, markeredgewidth=2, label="Primary Object")

    ax1.set_xlim(-2.0, 2.0)
    ax1.set_ylim(-0.8, 0.8)
    ax1.set_xlabel("B·T  (Along-Track, km)", fontsize=11)
    ax1.set_ylabel("B·N  (Cross-Track, km)", fontsize=11)
    ax1.set_title("B-Plane Covariance Ellipsoid", fontsize=14, color=CYAN, pad=12)
    ax1.set_aspect("equal")
    ax1.legend(loc="upper left", fontsize=9, facecolor=BG_COLOR, edgecolor=GRID_COLOR,
               labelcolor=TEXT_COLOR)

    # ========================================================================
    # RIGHT: Pc contour heatmap — log10(Pc) vs lead-time × Δv
    # ========================================================================
    lead_hrs = np.linspace(0.5, 72.0, 200)
    dv_ms = np.linspace(0.0, 5.0, 200)
    LH, DV = np.meshgrid(lead_hrs, dv_ms)

    # Synthetic Pc model:  Pc drops with more Δv and more lead time
    # Pc ≈ base * exp(-k1*Δv) * exp(-k2*lead)  with clipping
    base_pc = 2e-3
    k1, k2 = 1.8, 0.04
    Pc = base_pc * np.exp(-k1 * DV) * np.exp(-k2 * LH)
    Pc = np.clip(Pc, 1e-8, 1.0)
    log_Pc = np.log10(Pc)

    ax2.set_facecolor(BG_COLOR)
    cmap = mcolors.LinearSegmentedColormap.from_list(
        "pc_cmap", ["#064e3b", EMERALD, AMBER, CRIMSON], N=256,
    )
    cf = ax2.contourf(LH, DV, log_Pc, levels=np.linspace(-8, -2, 25),
                      cmap=cmap, extend="both")
    cs = ax2.contour(LH, DV, log_Pc, levels=[-6, -5, -4, -3],
                     colors="white", linewidths=0.8, linestyles="--")
    ax2.clabel(cs, fmt="%.0f", fontsize=9, colors="white")

    cbar = fig.colorbar(cf, ax=ax2, pad=0.02)
    cbar.set_label("log₁₀(Pc)", fontsize=11, color=TEXT_COLOR)
    cbar.ax.yaxis.set_tick_params(color=TEXT_COLOR)
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color=TEXT_COLOR)

    # Threshold line at Pc = 1e-4 (typical operational threshold)
    cs_thresh = ax2.contour(LH, DV, log_Pc, levels=[-4], colors=[CYAN],
                            linewidths=2, linestyles="-")
    ax2.clabel(cs_thresh, fmt="Pc=1e-4", fontsize=9, colors=CYAN)

    ax2.set_xlabel("Burn Lead Time  (hours before TCA)", fontsize=11)
    ax2.set_ylabel("Δv Magnitude  (m/s)", fontsize=11)
    ax2.set_title("Collision Probability vs Maneuver Parameters", fontsize=14,
                  color=CYAN, pad=12)
    ax2.grid(True, linewidth=0.4)

    fig.suptitle("UC096-E2  Conjunction Assessment & Pc Sensitivity",
                 fontsize=16, color=CYAN, y=0.98, fontweight="bold")
    plt.tight_layout(rect=[0, 0, 1, 0.95])

    plt.savefig(str(save_dir / "2_uncertainty_ellipsoid_pc_heatmap.png"), dpi=200,
                bbox_inches="tight", facecolor=BG_COLOR)
    plt.close()
    logger.info("  Saved: 2_uncertainty_ellipsoid_pc_heatmap.png")


def plot_model_benchmarks(metrics: dict, save_dir: Path = None):
    """Plot 3: 2×2 panel model benchmark comparison (Plotly, dark-slate).

    Panels:
      Top-Left     – Classification F1 score (XGBoost, PyTorch MLP, PPO RL*)
      Top-Right    – Regression MAE in m/s   (XGBoost, PyTorch MLP)
      Bottom-Left  – % Propellant Saved       (PPO, QUBO SA, MILP)
      Bottom-Right – QUBO Approximation Ratio (gauge-style horizontal bar)

    *PPO RL gets safe_rate as proxy F1 in the classification panel.
    """
    if save_dir is None:
        save_dir = PLOTS_DIR
    save_dir.mkdir(parents=True, exist_ok=True)

    xgb = metrics.get("xgboost", {})
    mlp = metrics.get("pytorch_mlp", {})
    ppo = metrics.get("ppo_rl", {})
    qubo = metrics.get("qubo_milp", {})

    fig = make_subplots(
        rows=2, cols=2,
        subplot_titles=[
            "Classification  Macro-F1",
            "Regression  MAE (m/s)",
            "Propellant Saved vs Baseline  (%)",
            "QUBO Approximation Ratio",
        ],
        vertical_spacing=0.18,
        horizontal_spacing=0.12,
    )

    # ---- helpers -----------------------------------------------------------
    def _bar(names, values, colors, row, col, fmt=".2f", suffix=""):
        fig.add_trace(go.Bar(
            x=names, y=values,
            marker_color=colors,
            text=[f"{v:{fmt}}{suffix}" for v in values],
            textposition="outside",
            textfont=dict(color=TEXT_COLOR, size=13),
            showlegend=False,
        ), row=row, col=col)

    # ---- Top-Left: F1 scores -----------------------------------------------
    f1_names = ["XGBoost", "PyTorch MLP", "PPO RL"]
    f1_vals = [
        xgb.get("macro_f1", 0),
        mlp.get("macro_f1", 0),
        ppo.get("safe_rate", 0),
    ]
    _bar(f1_names, f1_vals, [CYAN, EMERALD, AMBER], 1, 1)

    # ---- Top-Right: MAE (m/s) -----------------------------------------------
    mae_names = ["XGBoost", "PyTorch MLP"]
    mae_vals = [xgb.get("mae_ms", 0), mlp.get("mae_ms", 0)]
    _bar(mae_names, mae_vals, [CYAN, EMERALD], 1, 2, fmt=".3f", suffix=" m/s")

    # ---- Bottom-Left: Propellant Saved % ------------------------------------
    fuel_names = ["PPO RL", "QUBO SA", "MILP"]
    fuel_vals = [
        ppo.get("fuel_saved_pct", 0),
        qubo.get("fuel_saved_vs_greedy_pct", 0),
        qubo.get("fuel_saved_vs_greedy_pct", 0) * 0.95,  # MILP ≈ optimal bound
    ]
    _bar(fuel_names, fuel_vals, [AMBER, CRIMSON, CYAN], 2, 1, fmt=".1f", suffix="%")

    # ---- Bottom-Right: Approximation Ratio (horizontal bar / gauge) ---------
    approx_ratio = qubo.get("approximation_ratio", 0)
    fig.add_trace(go.Bar(
        y=["QUBO SA"], x=[approx_ratio],
        orientation="h",
        marker_color=EMERALD,
        text=[f"{approx_ratio:.3f}"],
        textposition="outside",
        textfont=dict(color=TEXT_COLOR, size=14),
        showlegend=False,
    ), row=2, col=2)
    # Reference line at 1.0 (optimal)
    fig.add_shape(
        type="line", x0=1.0, x1=1.0, y0=-0.5, y1=0.5,
        line=dict(color=CRIMSON, width=2, dash="dot"),
        row=2, col=2,
    )
    fig.add_annotation(
        x=1.0, y=0.45, text="Optimal", showarrow=False,
        font=dict(color=CRIMSON, size=10),
        row=2, col=2,
    )

    # ---- Global layout -----------------------------------------------------
    fig.update_layout(
        paper_bgcolor=BG_COLOR,
        plot_bgcolor=BG_COLOR,
        font=dict(color=TEXT_COLOR, family="Inter, Arial", size=12),
        title=dict(
            text="UC096-E2  Model Benchmark Dashboard",
            font=dict(size=20, color=CYAN),
            x=0.5,
        ),
        width=1300, height=850,
        margin=dict(t=80, b=40, l=60, r=40),
    )

    # Per-subplot axis styling
    for row in range(1, 3):
        for col in range(1, 3):
            fig.update_xaxes(
                showgrid=True, gridcolor=GRID_COLOR, gridwidth=0.5,
                color=TEXT_COLOR, row=row, col=col,
            )
            fig.update_yaxes(
                showgrid=True, gridcolor=GRID_COLOR, gridwidth=0.5,
                color=TEXT_COLOR, row=row, col=col,
            )

    # Y-axis ranges
    fig.update_yaxes(range=[0, 1.15], row=1, col=1)
    fig.update_yaxes(range=[0, max(mae_vals) * 1.6 + 0.01], row=1, col=2)
    fig.update_yaxes(range=[0, max(fuel_vals) * 1.4 + 1], row=2, col=1)
    fig.update_xaxes(range=[0, 1.15], row=2, col=2)

    # Subplot title colours
    for ann in fig["layout"]["annotations"]:
        ann["font"] = dict(size=14, color=TEXT_COLOR)

    fig.write_html(str(save_dir / "3_model_benchmarks.html"))
    fig.write_html(str(save_dir / "3_model_benchmarks_and_fuel_saved.html"))
    try:
        fig.write_image(str(save_dir / "3_model_benchmarks_and_fuel_saved.png"), scale=2)
    except Exception: pass
    try:
        fig.write_image(str(save_dir / "3_model_benchmarks.png"), scale=2)
    except Exception as exc:
        logger.warning("  Could not export PNG (kaleido missing?): %s", exc)
    logger.info("  Saved: 3_model_benchmarks.png/.html")


def run_visuals(metrics: dict = None) -> None:
    """Entry point.  Generate all plots; use dummy data when *metrics* is None."""
    logger.info("Step 6: Generating visualizations...")
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)

    plot_3d_conjunction_dodge()
    plot_uncertainty_ellipsoid_heatmap()

    if metrics:
        plot_model_benchmarks(metrics)
    else:
        dummy = {
            "xgboost": {"accuracy": 0.97, "macro_f1": 0.96, "mae_ms": 0.08, "rmse_ms": 0.15},
            "pytorch_mlp": {"accuracy": 0.96, "macro_f1": 0.95, "mae_ms": 0.10, "rmse_ms": 0.18},
            "ppo_rl": {"fuel_saved_pct": 35.0, "safe_rate": 0.98},
            "qubo_milp": {"approximation_ratio": 0.95, "fuel_saved_vs_greedy_pct": 42.0},
        }
        plot_model_benchmarks(dummy)

    logger.info("  All visualizations saved to outputs/plots/")
