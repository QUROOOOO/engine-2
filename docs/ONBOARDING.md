# QuantumOrbit Sim — Developer Onboarding Guide

Welcome to QuantumOrbit! This guide gets you up and running with the development environment in under 5 minutes.

---

## 1. Prerequisites
- **Node.js**: v20.x or higher
- **pnpm**: v9.x or higher
- **Python**: 3.10+ (for FastAPI backend)

---

## 2. Quickstart

### 2.1 Clone and Install
```bash
git clone https://github.com/organization/quantumorbit-sim.git
cd quantumorbit-sim/outputs/sim

# Install dependencies
pnpm install
```

### 2.2 Run Dev Server
```bash
# Starts Vite HMR dev server at http://localhost:5173
pnpm run dev
```

### 2.3 Run Backend API
```bash
cd ../..
python -m uvicorn api.index:app --reload --port 8000
```

---

## 3. Testing Workflows (TDD)

QuantumOrbit Sim enforces comprehensive testing with Vitest and Playwright.

| Command | Purpose |
| :--- | :--- |
| `pnpm run test` | Run all unit tests (47 tests across physics and UI logic) |
| `pnpm run test:watch` | Vitest interactive watch mode for TDD |
| `pnpm run test:coverage` | Generate statement & branch coverage reports |
| `pnpm run test:e2e` | Run Playwright critical user flow tests headlessly |
| `pnpm run test:a11y` | Run WCAG 2.2 AA accessibility audit |
| `pnpm run test:soak` | Run accelerated time-dilation soak test |
| `pnpm run typecheck` | Run strict TypeScript compiler verification (`tsc --noEmit`) |
| `pnpm run build` | Generate minified production bundle in `dist/` |

---

## 4. Deterministic Simulation Flag
To lock simulation time steps to constant ticks for bit-identical debugging across runs:
```bash
VITE_SIM_MODE=deterministic pnpm run dev
```
