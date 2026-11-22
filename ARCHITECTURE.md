# QuantumOrbit Sim — System Architecture

**System**: QuantumOrbit Orbital Conjunction Assessment Console  
**Standard**: C4 Model (Context, Containers, Components)  
**Target Environment**: WebGL (Three.js) + TypeScript (Vite) + FastAPI (Serverless)

---

## 1. System Context (C4 Level 1)

QuantumOrbit Sim provides proximity operations analysis, conjunction assessment, and impulsive collision avoidance maneuver (CAM) planning for active Earth observation satellites in Low Earth Orbit (LEO).

```mermaid
flowchart TD
    User["Orbital Flight Dynamics Officer"]
    CelesTrak["CelesTrak GP API\n(Upstream NORAD TLEs)"]
    
    subgraph QuantumOrbit["QuantumOrbit Platform"]
        Sim["QuantumOrbit Sim (Vite / WebGL)"]
        Backend["UC096 Engine 2 API (FastAPI)"]
    end
    
    User -->|"Monitors conjunctions & triggers burns"| Sim
    Sim -->|"Fetches live elements & submits telemetry"| Backend
    Backend -->|"Proxies & caches satellite elements"| CelesTrak
```

---

## 2. Container Diagram (C4 Level 2)

```mermaid
flowchart LR
    subgraph Browser["Client Browser (Desktop / Mobile)"]
        UI["DOM / UI Controller\n(Vanilla TS, WCAG 2.2 AA)"]
        Three["Three.js WebGL Viewport\n(SceneView, OrbitRig)"]
        Worker["Physics Web Worker\n(SGP4, Kepler Propagator)"]
        State["Simulation State Machine\n(SimulationClock, SimulationState)"]
        
        UI <--> State
        Three <--> State
        State <-->|"PostMessage (JSON/ArrayBuffer)"| Worker
    end

    subgraph Cloud["Vercel Cloud Edge"]
        EdgeCDN["Vercel Edge Network\n(Static Assets /dist)"]
        API["FastAPI Serverless Application\n(api/index.py)"]
        
        EdgeCDN -.->|"Serves HTML/JS/CSS"| Browser
        API <-->|"REST API (/api/v1/*)"| Browser
    end
```

---

## 3. Component Diagram: Physics & Simulation Core (C4 Level 3)

```mermaid
flowchart TD
    Clock["SimulationClock\n(Mulberry32 PRNG, Fixed Δt = 16.6ms)"]
    Bridge["PhysicsBridge\n(Worker Dispatch + Fallback)"]
    
    subgraph PhysicsCore["src/physics/ Core Modules"]
        SGP4["sgp4.ts\n(satellite.js TEME stateAt)"]
        Kepler["twoBody.ts\n(Universal Variable Kepler Solver)"]
        Stumpff["stumpff.ts\n(Stumpff c(z) and s(z) series)"]
        Coord["coordinateTransform.ts\n(Orthonormal RTN & B-Plane Projection)"]
        Prob["collisionProbability.ts\n(Foster-Chan 2D Gaussian Pc)"]
        Plan["maneuver.ts\n(CW Phasing & RTN Maneuver Optimizer)"]
        Synth["deriveEncounter.ts\n(Synthetic Conjunction Phase Shift)"]
    end

    Clock -->|"Advances SimMs"| Bridge
    Bridge --> SGP4
    Bridge --> Kepler
    Kepler --> Stumpff
    Bridge --> Coord
    Bridge --> Prob
    Bridge --> Plan
    Bridge --> Synth
```

---

## 4. Simulation Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> Initialization: Load TLE Catalog & Shaders
    Initialization --> CatalogLoaded: SGP4 Propagation Ready
    CatalogLoaded --> SweepConjunctions: Temporal Scan (t0 -> t0 + 25m)
    SweepConjunctions --> ThreatIdentified: Miss <= 5.0 km or Pc >= 1e-4
    SweepConjunctions --> NominalPass: No threat inside window
    
    ThreatIdentified --> ManeuverPlanning: Optimize along-track Δv
    ManeuverPlanning --> BurnExecutable: Feasible (Post-miss >= 5km, Fuel <= 15m/s)
    ManeuverPlanning --> Rejection: Infeasible / Exceeds Fuel
    
    BurnExecutable --> ExecutingBurn: User executes burn
    ExecutingBurn --> TrajectoryUpdated: Re-propagate post-burn state
    TrajectoryUpdated --> SweepConjunctions: Verify threat cleared
```

---

## 5. Web Worker Concurrency & Memory Safety
1. **Isolation**: High-overhead algorithms (`findApproach` across 400 debris objects, iterative Newton-Raphson Kepler solving) execute off the main rendering thread.
2. **Graceful Fallback**: If browser Web Workers are blocked by CSP or unsupported, `PhysicsBridge` automatically falls back to synchronous main thread execution without crashing.
3. **Data Immutability**: All states passed through the worker bridge are decoupled data transfer objects (DTOs), preventing shared memory race conditions.

---

## 6. Cyber Security & Hardened Boundary Architecture
1. **Security Headers Middleware**: Content Security Policy (strict script/style/connect/img/font/object restrictions), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Cross-Origin-Opener-Policy: same-origin`.
2. **Token Bucket Rate Limiting**: `slowapi` protects compute-intensive optimization endpoints (`60/min`) and anonymous telemetry ingestion (`120/min`).
3. **Strict Origin Validation**: Explicit whitelist for local and configured production hosts; wildcard CORS is disabled.
4. **Pydantic v2 Schema Enforcement**: All ingestion contracts strictly enforce `extra="forbid"` to eliminate parameter injection.
5. **SSRF & Memory Amplification Protection**: Upstream CelesTrak proxies enforce strict regex parsing, a 5.0s timeout, and a 2 MB streaming byte cap.

---

## 7. Thermal, Battery & Green Web Architecture
1. **HiDPI Clamping**: Render pixel ratio capped to `1.25x` in standard mode and `1.0x` in Eco mode, avoiding 4× to 9× pixel shading penalties on Retina/4K displays.
2. **Adaptive Framerate & Tab Sleep**:
   - `visibilitychange` handler completely sleeps WebGL rendering and physics loops when the browser tab is hidden.
   - On-demand rendering when paused: skips `renderer.render()` when camera controls have settled.
   - User-selectable Eco mode stepping frame interval to 30 FPS.
3. **Zero-Allocation RAF Loop**: Pre-allocated scratch matrices, vectors, and quaternions prevent GC allocation spikes during continuous 60 FPS animation.
4. **10 Hz DOM Throttling**: Decouples 60 FPS WebGL canvas rendering from DOM layout style calculations.
5. **Instanced Draw Call Budget**: Debris points and velocity vectors are batched via `THREE.Points` and `THREE.InstancedMesh`, keeping total draw calls $\le 20$.
