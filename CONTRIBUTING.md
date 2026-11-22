# Contributing to QuantumOrbit Sim

Thank you for contributing to QuantumOrbit Sim! To ensure mission-critical safety and code quality, please adhere to these standards.

---

## 1. Branching & Commit Conventions

### 1.1 Branch Naming
- `feature/<short-description>`: New features or capability enhancements.
- `fix/<issue-description>`: Bug fixes or astrodynamic numerical corrections.
- `perf/<optimization>`: Performance optimizations (e.g. WebGL instancing).
- `docs/<topic>`: Documentation updates.

### 1.2 Conventional Commits
All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
```text
<type>(<scope>): <short summary>

[optional body]
```
Examples:
- `feat(physics): add Foster-Chan B-plane collision probability calculation`
- `fix(maneuver): account for differential Keplerian drift in CW targeting`
- `perf(scene): batch debris points in single buffer geometry`
- `test(a11y): add WCAG 2.2 AA automated axe-core audit`

---

## 2. Pull Request Quality Gate Checklist

Before opening a pull request, ensure that:

1. **TypeScript Typecheck**:
   ```bash
   pnpm run typecheck
   ```
   Must pass with **0 errors** under `strict: true`.

2. **Unit Test Coverage**:
   ```bash
   pnpm run test:coverage
   ```
   Must maintain $\ge 85\%$ statement coverage across all physics and UI modules.

3. **Critical Flow E2E & Accessibility**:
   ```bash
   pnpm run test:e2e
   pnpm run test:a11y
   ```
   Must pass with **0 failures** and **0 WCAG 2.2 AA violations**.

4. **Production Build Budget**:
   ```bash
   pnpm run build
   ```
   Gzipped JavaScript must stay below **200 KB** and CSS below **150 KB**.
