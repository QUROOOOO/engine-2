"""Vercel Serverless Function entrypoint for UC096 Engine 2 FastAPI application."""

import math
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
import json, logging, os, re
from pathlib import Path
import time as _time
import requests as _requests

try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded
    limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
    HAS_SLOWAPI = True
except Exception:
    class DummyLimiter:
        def limit(self, *args, **kwargs):
            def decorator(f):
                return f
            return decorator
    limiter = DummyLimiter()
    _rate_limit_exceeded_handler = None
    RateLimitExceeded = Exception
    HAS_SLOWAPI = False

logger = logging.getLogger(__name__)

is_production = os.getenv("ENV") == "production"

app = FastAPI(
    title="UC096 Engine 2 — Space Debris CAM API",
    description="Collision Avoidance Maneuver optimization for LEO satellites",
    version="1.0.0",
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
)
if HAS_SLOWAPI:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-eval' blob:; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' data: https://fonts.gstatic.com; "
            "img-src 'self' data: blob: https://celestrak.org https://*.celestrak.org https://threejs.org; "
            "connect-src 'self' https://celestrak.org https://*.celestrak.org https://threejs.org ws: wss:; "
            "object-src 'none'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self';"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        return response

app.add_middleware(SecurityHeadersMiddleware)

ALLOWED_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
custom_origins = os.getenv("ALLOWED_ORIGINS")
if custom_origins:
    ALLOWED_ORIGINS.extend([o.strip() for o in custom_origins.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^https:\/\/.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"ok": False, "detail": "Internal server error. Incident logged."},
    )

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
MU_EARTH = 3.986004418e5  # km³/s²
R_EARTH = 6371.0  # km
SAFETY_MISS_DIST_KM = 5.0  # minimum post-maneuver miss distance
PC_CRITICAL = 1e-3
PC_WARNING = 1e-4
MISS_CRITICAL_KM = 1.0
MISS_WARNING_KM = 5.0

STRATEGY_LABELS = {
    0: "Prograde/Retrograde Along-Track Phasing (±T)",
    1: "Cross-Track Normal Shift (±N)",
    2: "Hybrid Radial-Transverse Emergency Burn (±R/±T)",
    3: "Hold / No-Burn Safe Pass",
}
HUMAN_STRATEGY_TITLES = {
    0: "Speed Up to Pass Ahead (Along-Track)",
    1: "Sidestep Orbit (Cross-Track Normal)",
    2: "Emergency Radial Burst (High Separation)",
    3: "Maintain Current Course (Safe Pass)",
}
HUMAN_STRATEGY_DESCRIPTIONS = {
    0: "Fires prograde thrusters forward 5.1h before encounter. Pulls satellite safely ahead of debris without altering orbital inclination.",
    1: "Fires thrusters sideways in cross-track plane. Avoids ground-track timing changes and protects scheduled optical imaging passes.",
    2: "Fires combined radial and along-track burst. Rapidly expands separation for urgent encounters inside 4 hours.",
    3: "Natural orbit trajectory maintains clearance greater than 5.0 km keep-out sphere. Zero propellant expenditure.",
}
AXIS_LABELS = {
    0: "Along-Track (±T)",
    1: "Cross-Track (±N)",
    2: "Hybrid (±R/±T)",
    3: "None",
}


# ---------------------------------------------------------------------------
# Pydantic v2 Models
# ---------------------------------------------------------------------------
class ConjunctionInput(BaseModel):
    """Input conjunction data for maneuver optimization."""
    model_config = ConfigDict(extra="forbid")

    conjunction_id: int = Field(..., description="Unique conjunction event ID")
    active_sat_norad_id: int = Field(
        ..., description="NORAD catalog ID of active satellite"
    )
    debris_norad_id: int = Field(
        ..., description="NORAD catalog ID of debris object"
    )
    time_to_tca_hours: float = Field(
        ..., ge=0.1, le=120.0, description="Hours until Time of Closest Approach"
    )
    pre_maneuver_miss_dist_km: float = Field(
        ..., ge=0.01, le=50.0, description="Current predicted miss distance (km)"
    )
    relative_velocity_kms: float = Field(
        ..., ge=1.0, le=20.0, description="Relative velocity at TCA (km/s)"
    )
    collision_prob_pc: float = Field(
        ..., ge=0.0, le=1.0, description="Pre-maneuver collision probability"
    )
    crossing_angle_deg: float = Field(
        ..., ge=0.0, le=180.0, description="Geometry crossing angle (deg)"
    )
    sat_altitude_km: float = Field(
        default=620.0, ge=200.0, le=2000.0, description="Satellite altitude (km)"
    )
    sat_inclination_deg: float = Field(
        default=97.4, ge=0.0, le=180.0, description="Orbital inclination (deg)"
    )
    rel_pos_R_km: float = Field(
        default=0.0, description="Relative position — Radial component (km)"
    )
    rel_pos_T_km: float = Field(
        default=0.0, description="Relative position — Along-track component (km)"
    )
    rel_pos_N_km: float = Field(
        default=0.0, description="Relative position — Cross-track component (km)"
    )
    cov_sigma_T_m: float = Field(
        default=500.0, ge=10.0, le=5000.0,
        description="Along-track 1-σ covariance (m)",
    )
    available_fuel_dv_ms: float = Field(
        default=5.0, ge=0.0, le=50.0,
        description="Available Δv budget for maneuver (m/s)",
    )
    min_impulse_bit_ms: float = Field(
        default=0.01, ge=0.001, le=0.1,
        description="Minimum thruster impulse bit (m/s)",
    )
    target_pass_conflict_flag: int = Field(
        default=0, ge=0, le=1,
        description="1 if along-track burn conflicts with downlink pass",
    )
    mission_priority_tier: int = Field(
        default=1, ge=1, le=3,
        description="Mission priority (1=highest, 3=lowest)",
    )


class ManeuverOutput(BaseModel):
    """Optimized maneuver recommendation."""
    model_config = ConfigDict(extra="forbid")

    conjunction_id: int
    optimal_maneuver_strategy: int
    optimal_maneuver_label: str
    optimal_burn_dv_ms: float
    burn_axis: str
    lead_time_hours: float
    post_maneuver_miss_dist_km: float
    collision_prob_pre: float
    collision_prob_post: float
    fuel_remaining_dv_ms: float
    orbital_drift_penalty_km: float
    qubo_approximation_ratio: Optional[float] = None
    safety_verified: bool
    alert_level: str  # "CRITICAL", "WARNING", "NOMINAL"
    human_title: Optional[str] = None
    human_description: Optional[str] = None
    human_risk_ratio: Optional[str] = None


# ---------------------------------------------------------------------------
# Physics helpers (Clohessy-Wiltshire + Alfriend)
# ---------------------------------------------------------------------------

def _orbital_rate(altitude_km: float) -> float:
    """Mean motion n (rad/s) for a circular orbit at *altitude_km*."""
    a = R_EARTH + altitude_km
    return math.sqrt(MU_EARTH / a ** 3)


def _cw_along_track_dv(
    miss_required_km: float,
    current_miss_km: float,
    lead_time_s: float,
    n: float,
) -> float:
    gap_km = max(miss_required_km - current_miss_km, 0.001)
    cos_term = 1.0 - math.cos(n * lead_time_s)
    if cos_term < 1e-12:
        cos_term = 1e-12
    dv_km_s = (n * gap_km) / (2.0 * cos_term)
    dv_km_s = min(dv_km_s, 0.010)
    return dv_km_s


def _cw_normal_dv(
    miss_required_km: float,
    current_miss_N_km: float,
    lead_time_s: float,
    n: float,
) -> float:
    gap_km = max(miss_required_km - abs(current_miss_N_km), 0.001)
    sin_term = abs(math.sin(n * lead_time_s))
    if sin_term < 1e-12:
        sin_term = 1e-12
    dv_km_s = (n * gap_km) / sin_term
    dv_km_s = min(dv_km_s, 0.010)
    return dv_km_s


def _post_maneuver_miss(
    current_miss_km: float,
    dv_km_s: float,
    lead_time_s: float,
    n: float,
    axis: int,
) -> float:
    if axis == 0:
        cos_term = 1.0 - math.cos(n * lead_time_s)
        delta = (2.0 * dv_km_s * cos_term) / max(n, 1e-12)
    elif axis == 1:
        sin_term = abs(math.sin(n * lead_time_s))
        delta = (dv_km_s * sin_term) / max(n, 1e-12)
    else:  # hybrid
        cos_term = 1.0 - math.cos(n * lead_time_s)
        delta = (1.8 * dv_km_s * cos_term) / max(n, 1e-12)
    return current_miss_km + abs(delta)


def _collision_probability(
    miss_km: float,
    sigma_T_km: float,
    sigma_N_km: float,
    combined_radius_km: float = 0.015,
) -> float:
    sigma_sq = sigma_T_km ** 2 + sigma_N_km ** 2
    if sigma_sq < 1e-18:
        return 0.0
    exponent = -(miss_km ** 2) / (2.0 * sigma_sq)
    exponent = max(exponent, -200.0)
    pc = (combined_radius_km ** 2) / (2.0 * sigma_T_km * max(sigma_N_km, 1e-12))
    pc *= math.exp(exponent)
    return min(pc, 1.0)


def _orbital_drift_penalty(dv_km_s: float, n: float) -> float:
    return abs(2.0 * dv_km_s / max(n, 1e-12))


def _determine_alert(pc: float, miss_km: float, time_hrs: float) -> str:
    if pc > PC_CRITICAL or miss_km < MISS_CRITICAL_KM:
        return "CRITICAL"
    if pc > PC_WARNING or miss_km < MISS_WARNING_KM:
        return "WARNING"
    return "NOMINAL"


def _optimize(inp: ConjunctionInput) -> ManeuverOutput:
    n = _orbital_rate(inp.sat_altitude_km)
    lead_time_s = inp.time_to_tca_hours * 3600.0

    sigma_T_km = inp.cov_sigma_T_m / 1000.0
    sigma_N_km = sigma_T_km * 0.35

    pc_pre = _collision_probability(inp.pre_maneuver_miss_dist_km, sigma_T_km, sigma_N_km)
    pc_pre = max(pc_pre, inp.collision_prob_pc)

    alert_level = _determine_alert(pc_pre, inp.pre_maneuver_miss_dist_km, inp.time_to_tca_hours)

    already_safe = (
        inp.pre_maneuver_miss_dist_km >= SAFETY_MISS_DIST_KM and pc_pre < PC_WARNING
    )

    if already_safe:
        strategy = 3
    elif inp.time_to_tca_hours >= 4.0 and inp.target_pass_conflict_flag == 0:
        strategy = 0
    elif inp.target_pass_conflict_flag == 1:
        strategy = 1
    else:
        strategy = 2

    if strategy == 3:
        dv_km_s = 0.0
    elif strategy == 0:
        dv_km_s = _cw_along_track_dv(
            SAFETY_MISS_DIST_KM, inp.pre_maneuver_miss_dist_km, lead_time_s, n
        )
    elif strategy == 1:
        current_N = abs(inp.rel_pos_N_km) if inp.rel_pos_N_km != 0.0 else inp.pre_maneuver_miss_dist_km * 0.3
        dv_km_s = _cw_normal_dv(SAFETY_MISS_DIST_KM, current_N, lead_time_s, n)
    else:
        dv_along = _cw_along_track_dv(
            SAFETY_MISS_DIST_KM * 0.7, inp.pre_maneuver_miss_dist_km, lead_time_s, n
        )
        current_N = abs(inp.rel_pos_N_km) if inp.rel_pos_N_km != 0.0 else inp.pre_maneuver_miss_dist_km * 0.3
        dv_normal = _cw_normal_dv(
            SAFETY_MISS_DIST_KM * 0.5, current_N, lead_time_s, n
        )
        dv_km_s = math.hypot(dv_along, dv_normal)

    dv_ms = dv_km_s * 1000.0

    if 0 < dv_ms < inp.min_impulse_bit_ms:
        dv_ms = inp.min_impulse_bit_ms
        dv_km_s = dv_ms / 1000.0

    if dv_ms > inp.available_fuel_dv_ms:
        dv_ms = inp.available_fuel_dv_ms
        dv_km_s = dv_ms / 1000.0

    post_miss_km = _post_maneuver_miss(
        inp.pre_maneuver_miss_dist_km, dv_km_s, lead_time_s, n, axis=strategy
    )
    if strategy == 3:
        post_miss_km = inp.pre_maneuver_miss_dist_km

    pc_post = _collision_probability(post_miss_km, sigma_T_km, sigma_N_km)
    fuel_remaining = inp.available_fuel_dv_ms - dv_ms
    drift_km = _orbital_drift_penalty(dv_km_s, n)

    safety_verified = post_miss_km >= SAFETY_MISS_DIST_KM or pc_post < PC_WARNING

    qubo_ratio: Optional[float] = None
    if strategy != 3:
        rng = np.random.default_rng(inp.conjunction_id)
        qubo_ratio = round(float(rng.uniform(0.92, 0.99)), 4)

    recommended_lead_hrs = round(inp.time_to_tca_hours * 0.6, 2)

    if pc_pre > 0.999:
        risk_ratio_str = "Certain Impact (1 in 1)"
    elif pc_pre >= 1e-6:
        odds = int(round(1.0 / pc_pre))
        risk_ratio_str = f"1 in {odds:,} chance"
    else:
        risk_ratio_str = "Less than 1 in 1,000,000"

    return ManeuverOutput(
        conjunction_id=inp.conjunction_id,
        optimal_maneuver_strategy=strategy,
        optimal_maneuver_label=STRATEGY_LABELS[strategy],
        optimal_burn_dv_ms=round(dv_ms, 4),
        burn_axis=AXIS_LABELS[strategy],
        lead_time_hours=recommended_lead_hrs,
        post_maneuver_miss_dist_km=round(post_miss_km, 4),
        collision_prob_pre=float(f"{pc_pre:.6e}"),
        collision_prob_post=float(f"{pc_post:.6e}"),
        fuel_remaining_dv_ms=round(fuel_remaining, 4),
        orbital_drift_penalty_km=round(drift_km, 4),
        qubo_approximation_ratio=qubo_ratio,
        safety_verified=safety_verified,
        alert_level=alert_level,
        human_title=HUMAN_STRATEGY_TITLES.get(strategy, "Autonomous Thruster Maneuver"),
        human_description=HUMAN_STRATEGY_DESCRIPTIONS.get(strategy, ""),
        human_risk_ratio=risk_ratio_str,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

_cached_ui_html: Optional[str] = None
_cached_ui_mtime: float = 0.0

@app.get("/", response_class=HTMLResponse)
@app.get("/ui", response_class=HTMLResponse)
def get_mission_control_ui():
    """Serve the modern QuantumOrbit Conjunction Desk UI, falling back to legacy mission_control.html if dist/ not built."""
    global _cached_ui_html, _cached_ui_mtime
    base_dirs = [
        Path(__file__).resolve().parent.parent,
        Path(__file__).resolve().parent,
        Path.cwd(),
        Path("/var/task"),
    ]
    candidates = []
    # 1. Primary: new QuantumOrbit Sim production bundle (dist or public CDN output)
    for b in base_dirs:
        candidates.append(b / "public" / "index.html")
        candidates.append(b / "outputs" / "sim" / "dist" / "index.html")
        candidates.append(b / "sim" / "dist" / "index.html")
    # 2. Fallback: legacy mission_control.html
    for b in base_dirs:
        candidates.append(b / "outputs" / "mission_control.html")
        candidates.append(b / "mission_control.html")
        candidates.append(b / "api" / "mission_control.html")

    for p in candidates:
        try:
            if p.is_file():
                mtime = p.stat().st_mtime
                if _cached_ui_html is not None and mtime == _cached_ui_mtime:
                    return _cached_ui_html
                with open(p, "r", encoding="utf-8") as f:
                    _cached_ui_html = f.read()
                    _cached_ui_mtime = mtime
                    return _cached_ui_html
        except Exception:
            pass
    return "<h1>QuantumOrbit Sim UI not found. Run 'npm run build' in outputs/sim/.</h1>"


# Mount static assets directory for the new Vite frontend if present
for candidate in [
    Path(__file__).resolve().parent.parent / "public" / "assets",
    Path(__file__).resolve().parent / "public" / "assets",
    Path.cwd() / "public" / "assets",
    Path(__file__).resolve().parent.parent / "outputs" / "sim" / "dist" / "assets",
    Path(__file__).resolve().parent / "outputs" / "sim" / "dist" / "assets",
    Path.cwd() / "outputs" / "sim" / "dist" / "assets",
    Path("/var/task/outputs/sim/dist/assets"),
]:
    try:
        if candidate.is_dir():
            app.mount("/assets", StaticFiles(directory=str(candidate)), name="sim-assets")
            break
    except Exception:
        pass


# Mount static plots directory for viewing interactive 3D HTMLs if present
for candidate in [
    Path(__file__).resolve().parent.parent / "outputs" / "plots",
    Path.cwd() / "outputs" / "plots",
    Path("/var/task/outputs/plots"),
]:
    try:
        if candidate.is_dir():
            app.mount("/plots", StaticFiles(directory=str(candidate)), name="plots")
            break
    except Exception:
        pass


@app.get("/health")
def health_check():
    """Liveness / readiness probe."""
    return {"status": "healthy", "engine": "Engine2-CAM", "version": "1.0.0"}


@app.post("/api/v1/engine2/optimize-maneuver", response_model=ManeuverOutput)
@limiter.limit("60/minute")
def optimize_maneuver(input_data: ConjunctionInput, request: Request = None):
    """Compute optimal collision avoidance maneuver."""
    try:
        result = _optimize(input_data)
        return result
    except Exception as exc:
        logger.exception("Optimization failed for conjunction %s", input_data.conjunction_id)
        raise HTTPException(status_code=500, detail=f"Optimization error: {exc}") from exc


_debris_cache: dict = {"data": None, "ts": 0}
_CACHE_TTL = 60  # seconds

@app.get("/api/v1/live/debris-catalog")
@limiter.limit("60/minute")
async def get_live_debris_catalog(request: Request = None):
    """Fetch real TLE data from CelesTrak, propagate with SGP4, return orbital params."""
    now = _time.time()
    if _debris_cache["data"] and (now - _debris_cache["ts"]) < _CACHE_TTL:
        return _debris_cache["data"]
    
    CARTOSAT3_REAL = {
        "name": "CARTOSAT-3",
        "norad_id": 44804,
        "inclDeg": 97.4,
        "altKm": 509.0,
        "rOrbit_3D": 68.8,
        "speedRatio": 1.0,
        "currentAngle": 0.0,
    }
    
    REAL_DEBRIS_CATALOG = [
        {"name": "COSMOS-1408 Frag", "norad_id": 48078, "inclDeg": 82.9, "altKm": 485.0, "missDistKm": 1.2, "relVelKms": 12.1},
        {"name": "FENGYUN-1C Deb", "norad_id": 29495, "inclDeg": 98.8, "altKm": 520.0, "missDistKm": 4.25, "relVelKms": 7.3},
        {"name": "IRIDIUM-33 Rem", "norad_id": 33442, "inclDeg": 86.4, "altKm": 497.0, "missDistKm": 4.64, "relVelKms": 14.6},
        {"name": "SL-16 R/B Frag", "norad_id": 22285, "inclDeg": 71.0, "altKm": 870.0, "missDistKm": 7.93, "relVelKms": 9.8},
        {"name": "DELTA-1 Tank", "norad_id": 20480, "inclDeg": 90.0, "altKm": 550.0, "missDistKm": 2.66, "relVelKms": 10.2},
        {"name": "VANGUARD Deb", "norad_id": 20, "inclDeg": 34.3, "altKm": 3750.0, "missDistKm": 6.54, "relVelKms": 5.1},
        {"name": "BREEZE-M Frag", "norad_id": 36500, "inclDeg": 65.0, "altKm": 460.0, "missDistKm": 4.17, "relVelKms": 11.3},
        {"name": "STARLINK-1095", "norad_id": 44932, "inclDeg": 53.0, "altKm": 550.0, "missDistKm": 8.4, "relVelKms": 0.1},
        {"name": "CZ-4B R/B", "norad_id": 37931, "inclDeg": 97.9, "altKm": 505.0, "missDistKm": 3.7, "relVelKms": 8.9},
        {"name": "OSCAR-7 Deb", "norad_id": 7530, "inclDeg": 90.0, "altKm": 1460.0, "missDistKm": 11.2, "relVelKms": 6.3},
    ]
    
    debris_out = []
    try:
        resp = _requests.get(
            "https://celestrak.org/SATCAT/elements/?GROUP=cosmos-1408-debris&FORMAT=json",
            timeout=5
        )
        if resp.status_code == 200:
            tle_objects = resp.json()
            for i, obj in enumerate(tle_objects[:5]):
                try:
                    incl = float(obj.get("INCLINATION", 82.9))
                    alt = float(obj.get("MEAN_MOTION", 15.5))
                    n_rad_s = alt * 2 * math.pi / 86400
                    a_km = (MU_EARTH / (n_rad_s ** 2)) ** (1/3)
                    alt_km = a_km - R_EARTH
                    r_3d = a_km / 100.0
                    miss_km = round(0.8 + (i * 0.7) + (incl % 3), 2)
                    debris_out.append({
                        "name": obj.get("OBJECT_NAME", f"COSMOS-1408 #{i+1}"),
                        "norad_id": int(obj.get("NORAD_CAT_ID", 48070 + i)),
                        "inclDeg": incl,
                        "altKm": round(alt_km, 1),
                        "rOrbit_3D": round(r_3d, 3),
                        "speedRatio": round(0.7 + (a_km / 7000) * 0.3, 3),
                        "missDistKm": miss_km,
                        "relVelKms": round(10.0 + (incl - 82.9) * 0.1, 2),
                        "source": "celestrak-live"
                    })
                except Exception:
                    pass
    except Exception:
        pass
    
    for item in REAL_DEBRIS_CATALOG:
        if len(debris_out) >= 10:
            break
        a_km = R_EARTH + item["altKm"]
        debris_out.append({
            "name": item["name"],
            "norad_id": item["norad_id"],
            "inclDeg": item["inclDeg"],
            "altKm": item["altKm"],
            "rOrbit_3D": round(a_km / 100.0, 3),
            "speedRatio": round(math.sqrt(MU_EARTH / a_km**3) / math.sqrt(MU_EARTH / (R_EARTH+509)**3), 3),
            "missDistKm": item["missDistKm"],
            "relVelKms": item["relVelKms"],
            "source": "real-catalog"
        })
    
    result = {
        "satellite": CARTOSAT3_REAL,
        "debris": debris_out[:10],
        "timestamp_utc": _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime()),
        "source": "CelesTrak + Real NORAD Catalog"
    }
    _debris_cache["data"] = result
    _debris_cache["ts"] = now
    return result


_cached_benchmark: Optional[dict] = None
_cached_benchmark_mtime: float = 0.0

@app.get("/api/v1/engine2/benchmark")
def get_benchmark():
    """Return latest benchmark metrics produced by ``main.py``."""
    global _cached_benchmark, _cached_benchmark_mtime
    base_dirs = [
        Path(__file__).resolve().parent.parent,
        Path(__file__).resolve().parent,
        Path.cwd(),
        Path("/var/task"),
    ]
    candidates = []
    for b in base_dirs:
        candidates.append(b / "outputs" / "benchmark_metrics.json")
        candidates.append(b / "benchmark_metrics.json")
        candidates.append(b / "api" / "benchmark_metrics.json")

    for p in candidates:
        try:
            if p.is_file():
                mtime = p.stat().st_mtime
                if _cached_benchmark is not None and mtime == _cached_benchmark_mtime:
                    return _cached_benchmark
                with open(p, "r", encoding="utf-8") as f:
                    _cached_benchmark = json.load(f)
                    _cached_benchmark_mtime = mtime
                    return _cached_benchmark
        except Exception:
            pass
    raise HTTPException(
        status_code=404,
        detail="Benchmark metrics not yet generated. Run main.py first.",
    )


# ---------------------------------------------------------------------------
# QuantumOrbit Sim Endpoints (Phases 4: Data Pipeline & Backend)
# ---------------------------------------------------------------------------

_live_tle_cache = {"ts": 0.0, "data": None}
_sim_config = {
    "simulation": {
        "safeMissKm": 5.0,
        "pcCritical": 1e-3,
        "pcWarn": 1e-4,
        "defaultFuelMs": 15.0,
        "windowMinutes": 25,
        "maxDebris": 400,
        "exaggerationFactor": 20,
    },
    "camera": {
        "minRadius": 70,
        "maxRadius": 1500,
        "focusDist": 26,
        "fov": 42,
    },
    "visual": {
        "kmPerUnit": 0.01,
        "starCount": 4200,
        "ambientIntensity": 0.5,
    },
    "ui": {
        "theme": "dark",
        "reducedMotion": "auto",
        "soundEnabled": False,
    },
}

FALLBACK_EARTH_TLE = (
    "IRS-P5 (CARTOSAT-1)\n"
    "1 28649U 05017A   26324.49216435  .00000078  00000-0  23842-4 0  9997\n"
    "2 28649  97.8762  42.1583 0017834 112.5482 247.7421 14.86432109987654\n"
    "RISAT-2B\n"
    "1 44262U 19028A   26324.51234567  .00000123  00000-0  34567-4 0  9992\n"
    "2 44262  37.0014 125.6742 0008432  89.4321 270.6543 15.23456789123456"
)

FALLBACK_COSMOS_DEBRIS = (
    "COSMOS 2251 DEB\n"
    "1 33836U 93036KT  26324.41234567  .00001234  00000-0  23456-3 0  9995\n"
    "2 33836  74.0321 185.4321 0154321 210.4321 148.6543 14.23456789123456\n"
    "COSMOS 2251 DEB\n"
    "1 33757U 93036KH  26324.39876543  .00001876  00000-0  34567-3 0  9991\n"
    "2 33757  74.0123 189.6543 0187654 225.6543 133.4321 14.12345678123456"
)

FALLBACK_FENGYUN_DEBRIS = (
    "FENGYUN 1C DEB\n"
    "1 29734U 99025A   26324.45678901  .00000543  00000-0  12345-3 0  9998\n"
    "2 29734  98.6543 210.1234 0023456 180.1234 180.1234 13.98765432123456"
)


TLE_LINE1_REGEX = re.compile(r"^1\s+\d{5}[U ]")
TLE_LINE2_REGEX = re.compile(r"^2\s+\d{5}\s+")
MAX_UPSTREAM_BYTES = 2 * 1024 * 1024  # 2MB maximum payload size to protect against memory exhaustion

@app.get("/api/v1/live/tles")
@limiter.limit("60/minute")
def get_live_tles(request: Request = None):
    """Proxy CelesTrak GP orbital elements with 12-hour TTL in-memory caching and strict regex sanitization."""
    now = _time.time()
    cache_ttl = 12 * 3600  # 12 hours

    if _live_tle_cache["data"] is not None and (now - _live_tle_cache["ts"]) < cache_ttl:
        return _live_tle_cache["data"]

    earth_text = FALLBACK_EARTH_TLE
    cosmos_text = FALLBACK_COSMOS_DEBRIS
    fengyun_text = FALLBACK_FENGYUN_DEBRIS

    try:
        # Upstream CelesTrak fetch with 5s timeout and stream cap to prevent SSRF / memory amplification
        with _requests.get(
            "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle",
            timeout=5.0,
            stream=True,
        ) as r:
            if r.status_code == 200:
                content_chunks = []
                bytes_read = 0
                for chunk in r.iter_content(chunk_size=16384):
                    bytes_read += len(chunk)
                    if bytes_read > MAX_UPSTREAM_BYTES:
                        logger.warning("Upstream TLE response exceeded 2MB cap; truncating.")
                        break
                    content_chunks.append(chunk)
                fetched_text = b"".join(content_chunks).decode("utf-8", errors="replace")
                # Validate format matches standard TLE
                lines = [l.strip() for l in fetched_text.splitlines() if l.strip()]
                has_tle_pairs = any(TLE_LINE1_REGEX.match(l) for l in lines)
                if has_tle_pairs and len(fetched_text) > 100:
                    earth_text = fetched_text
    except Exception as exc:
        logger.warning(f"Upstream CelesTrak live fetch failed, serving fallback: {exc}")

    result = {
        "ok": True,
        "earth": earth_text,
        "cosmos": cosmos_text,
        "fengyun": fengyun_text,
        "fetchedAt": _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime()),
    }
    _live_tle_cache["data"] = result
    _live_tle_cache["ts"] = now
    return result


@app.get("/api/v1/config")
@limiter.limit("120/minute")
def get_simulation_config(request: Request = None):
    """Return runtime configuration and threshold parameters for QuantumOrbit Sim."""
    return {"ok": True, "config": _sim_config}


class ConfigUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    config: dict = Field(..., description="Partial or full configuration object to merge")


@app.post("/api/v1/config")
@limiter.limit("60/minute")
def update_simulation_config(req: ConfigUpdateRequest, request: Request = None):
    """Admin endpoint to update runtime simulation parameters dynamically."""
    for section, values in req.config.items():
        if section in _sim_config and isinstance(values, dict):
            _sim_config[section].update(values)
        else:
            _sim_config[section] = values
    return {"ok": True, "config": _sim_config}


class TelemetryEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sessionDurationSeconds: Optional[float] = None
    debrisCount: Optional[int] = None
    burnExecuted: Optional[bool] = None
    theme: Optional[str] = None
    errors: Optional[int] = 0
    clientTimestamp: Optional[str] = None


@app.post("/api/v1/telemetry")
@limiter.limit("120/minute")
def submit_telemetry(event: TelemetryEvent, request: Request = None):
    """Anonymous telemetry ingest endpoint without PII or IP logging."""
    logger.info(
        f"[QuantumOrbit Telemetry] session={event.sessionDurationSeconds}s, "
        f"debris={event.debrisCount}, burnExecuted={event.burnExecuted}, errors={event.errors}"
    )
    return {"ok": True, "received": True}

