# QuantumOrbit Sim — Accessibility Compliance & Audit Report

**Compliance Standard**: WCAG 2.2 Level AA  
**Evaluation Target**: `outputs/sim/` (Orbital Conjunction Analysis Console)  
**Last Audit**: November 2026

---

## 1. Executive Summary
QuantumOrbit Sim provides proximity operations and conjunction assessment for low Earth orbit (LEO). Although the core visualization relies on WebGL (Three.js), all operational controls, risk metrics, telemetry readouts, and tactical controls adhere strictly to WCAG 2.2 Level AA accessibility standards, allowing full usability for keyboard navigation, screen reader assistance (NVDA, VoiceOver, JAWS), and reduced-motion user preferences.

---

## 2. Accessibility Architecture

### 2.1 Color Contrast Compliance (WCAG 1.4.3 & 1.4.11)
All active text and interactive components maintain a minimum contrast ratio of **4.5:1** against their background surfaces (and **3:1** for large text or graphical state markers):

| UI Token / State | Foreground | Background | Measured Contrast Ratio | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Dark Theme Body Text** (`--text`) | `#ece9e3` | `#07080a` | **17.8:1** | Pass (AAA) |
| **Dark Theme Subtext / Dim** (`--dim`) | `#8c9098` | `#07080a` | **6.4:1** | Pass (AA) |
| **Critical Threat Chip** (`--crit`) | `#ff4136` | `rgba(255,65,54,0.08)` on `#101317` | **4.9:1** | Pass (AA) |
| **Warning Threat Chip** (`--warn`) | `#ffc24b` | `rgba(255,194,75,0.07)` on `#101317` | **9.2:1** | Pass (AAA) |
| **Safe Status Indicator** (`--safe`) | `#63e6a8` | `rgba(99,230,168,0.28)` on `#101317` | **10.5:1** | Pass (AAA) |
| **Light Theme Body Text** | `#15120e` | `#e9e5dd` | **15.4:1** | Pass (AAA) |
| **Light Theme Dim** | `#6a655d` | `#e9e5dd` | **4.8:1** | Pass (AA) |

### 2.2 Focus Indicators (WCAG 2.4.7 & 2.4.13)
- Focus visibility is enforced globally via `:focus-visible`:
  ```css
  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  ```
- Focus states are never suppressed (`outline: none` without replacement is strictly disallowed).
- Focus remains confined within active modal dialogs (`#help` navigation panel) and returns to the triggering button upon dismissal.

### 2.3 ARIA Roles & Live Regions (WCAG 4.1.2 & 4.1.3)
Dynamic operational state changes provide immediate non-visual feedback:
- **Collision Risk Alerts**: `#threatPc` and `#riskChip` contain `role="status"` and `aria-live="polite"` so screen readers announce changes in threat level without disrupting active narration.
- **Loading Overlay**: `#loading` has `role="status"` and `aria-live="polite"` announcing propagation progress.
- **Mission Elapsed Time**: `#met` has `role="timer"` and `aria-label="Mission Elapsed Time"`.
- **Timeline Scrub**: `#timeline` provides `role="slider"`, `tabindex="0"`, `aria-valuemin="0"`, `aria-valuemax="100"`, and `aria-valuenow="0"`.
- **Canvas Fallbacks**: Both the 3D WebGL viewport (`#view`) and 2D B-plane encounter canvas (`#bplane`) feature `role="img"` and descriptive fallback `aria-label` text.

### 2.4 Reduced Motion (WCAG 2.3.3)
When `prefers-reduced-motion: reduce` is detected:
- All CSS animations and transitions are clamped to `<= 0.01ms`.
- The loading spinner rotation is stopped and converted to a static dashed indicator.
- Three.js smooth camera flight interpolations (`dolly`, `orbit`) immediately snap to target coordinates without disorienting vestibular motion.

---

## 3. Keyboard Navigation Matrix

| Key / Shortcut | Target Component | Action |
| :--- | :--- | :--- |
| <kbd>Tab</kbd> / <kbd>Shift + Tab</kbd> | All interactive elements | Sequential navigation in natural DOM order |
| <kbd>Space</kbd> | Simulation Engine | Toggle simulation play / pause |
| <kbd>F</kbd> | Camera / Viewport | Focus camera on currently selected orbital asset |
| <kbd>?</kbd> | Global | Open Keyboard Navigation modal dialog |
| <kbd>Escape</kbd> | Help Modal (`#help`) | Close open dialog and restore previous focus |
| <kbd>Enter</kbd> | Search / Stepper / Action | Trigger selected button or maneuver burn |

---

## 4. Automated Testing Checklist
- `@axe-core/playwright` test runner in `tests/e2e/a11y.spec.ts`.
- Validates 0 critical, serious, or moderate violations on:
  - Initial page load.
  - Conjunction critical threat state.
  - Navigation modal dialog state.
  - Light mode theme switch.
