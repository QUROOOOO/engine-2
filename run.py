#!/usr/bin/env python3
"""
QuantumOrbit · Engine 2: Autonomous Space Debris Collision Avoidance (CAM)
Cross-Platform Startup & Execution Script (Windows / macOS / Linux)

Usage:
    python run.py                   # Launch 3D Mission Control Server & open browser
    python run.py --port 8080       # Custom port
    python run.py --no-browser      # Run server in headless mode
    python run.py --pipeline        # Run full ML training & benchmark pipeline
"""

import sys
import os
import time
import argparse
import webbrowser
import threading
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def print_banner(host: str, port: int):
    url = f"http://{host}:{port}/"
    print("\n" + "=" * 68)
    print("  QUANTUMORBIT · CONSTELLATION OPTIMIZER (UC-096)")
    print("  Engine 2: Autonomous Space Debris Collision Avoidance (CAM)")
    print("=" * 68)
    print(f"  • Mission Control UI :  {url}")
    print(f"  • OpenAPI / Swagger  :  {url}docs")
    print(f"  • Health Probe       :  {url}health")
    print(f"  • Benchmark Telemetry:  {url}api/v1/engine2/benchmark")
    print("=" * 68)
    print("  Press Ctrl+C to terminate the server.\n")


def open_browser(url: str, delay_sec: float = 1.2):
    """Wait for server to bind socket, then open browser."""
    def _open():
        time.sleep(delay_sec)
        try:
            webbrowser.open(url)
        except Exception as e:
            print(f"[Notice] Could not auto-launch browser: {e}")
    t = threading.Thread(target=_open, daemon=True)
    t.start()


def run_server(host: str = "127.0.0.1", port: int = 8000, auto_open: bool = True, dev_mode: bool = False):
    """Start the FastAPI backend with uvicorn. Reload is disabled by default to prevent CPU polling and battery drain."""
    try:
        import uvicorn
    except ImportError:
        print("[Error] 'uvicorn' is required. Install via: pip install uvicorn")
        sys.exit(1)

    print_banner(host, port)
    target_url = f"http://localhost:{port}/" if host in ("127.0.0.1", "0.0.0.0") else f"http://{host}:{port}/"  # nosec B104

    if auto_open:
        open_browser(target_url)

    try:
        uvicorn.run("src.api:app", host=host, port=port, reload=dev_mode, log_level="info")
    except KeyboardInterrupt:
        print("\n[QuantumOrbit] Mission Control Server shut down cleanly.")


def run_pipeline(skip_tle: bool = True):
    """Execute the end-to-end ML & Optimization pipeline."""
    import subprocess  # nosec B404
    cmd = [sys.executable, "main.py"]
    if skip_tle:
        cmd.append("--skip-tle")
    print(f"[QuantumOrbit] Executing pipeline: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)  # nosec B603


def main():
    parser = argparse.ArgumentParser(
        description="QuantumOrbit Engine 2 — Startup & Execution Script"
    )
    parser.add_argument(
        "--host", default="127.0.0.1", help="Host interface to bind (default: 127.0.0.1)"
    )
    parser.add_argument(
        "--port", type=int, default=8000, help="Port to listen on (default: 8000)"
    )
    parser.add_argument(
        "--no-browser", action="store_true", help="Disable automatic browser opening"
    )
    parser.add_argument(
        "--pipeline", action="store_true", help="Run full ML/Optimization training pipeline"
    )
    parser.add_argument(
        "--with-tle", action="store_true", help="Fetch live CelesTrak TLEs when running pipeline"
    )
    parser.add_argument(
        "--dev", action="store_true", help="Enable dev reload mode (increases battery/CPU load)"
    )

    args = parser.parse_args()

    if args.pipeline:
        run_pipeline(skip_tle=not args.with_tle)
    else:
        run_server(host=args.host, port=args.port, auto_open=not args.no_browser, dev_mode=args.dev)


if __name__ == "__main__":
    main()
