"""FastAPI microservice for the shared 3D Mission Control UI.
Re-exports from api.index for consistent local and serverless execution.
"""

from api.index import (
    app,
    ConjunctionInput,
    ManeuverOutput,
    optimize_maneuver,
    get_mission_control_ui,
    get_live_debris_catalog,
    get_live_tles,
    get_simulation_config,
    submit_telemetry,
    get_benchmark,
    health_check,
)

__all__ = [
    "app",
    "ConjunctionInput",
    "ManeuverOutput",
    "optimize_maneuver",
    "get_mission_control_ui",
    "get_live_debris_catalog",
    "get_live_tles",
    "get_simulation_config",
    "submit_telemetry",
    "get_benchmark",
    "health_check",
]
