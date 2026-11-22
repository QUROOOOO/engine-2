# QuantumOrbit Sim — Operations Runbook & Incident Response

**Scope**: Production operations, deployment lifecycle, incident response, and runtime debugging.

---

## 1. Production Deployment & Rollback

### 1.1 Deployment Pipeline
- Automatic Continuous Deployment is managed via `.github/workflows/deploy.yml`.
- Pushes to `main` trigger a full build and deployment to Vercel Production.
- Pull Requests trigger ephemeral preview environments with automated Playwright and accessibility checks.

### 1.2 Instantaneous Rollback
If a severe regression is detected in production:
1. Open the [Vercel Dashboard](https://vercel.com).
2. Navigate to **Deployments**.
3. Locate the previous known-healthy deployment hash.
4. Select the options menu (`...`) &rarr; **Instant Rollback**.
5. Traffic will be routed to the previous build within $\le 5$ seconds.

Alternatively via CLI:
```bash
npx vercel rollback <deployment-url-or-id> --token=$VERCEL_TOKEN
```

---

## 2. Upstream Outage Triage (CelesTrak)

QuantumOrbit Sim fetches active TLE catalogs from CelesTrak. If CelesTrak experiences downtime:
1. **Behavior**: `api/index.py` handles timeouts (5s limit) and catches network errors.
2. **Fallback**: Returns cached local catalog with high-fidelity Cartosat-1, RISAT-2B, and Cosmos/Fengyun debris records.
3. **Client Notification**: Client displays non-intrusive toast: `USING CACHED CATALOGUE`.
4. **Verification**:
   ```bash
   curl -I https://celestrak.org/NORAD/elements/gp.php
   ```

---

## 3. Runtime Console Diagnostic API (`window.__sim`)

In browser DevTools, the simulation engine exposes runtime operational commands on `window.__sim`:

| Command | Return / Effect | Description |
| :--- | :--- | :--- |
| `__sim.state` | Object | Inspect current simulation state (epoch, rates, active threat) |
| `__sim.exportState()` | JSON String | Export bit-identical simulation state snapshot |
| `__sim.importState(json)` | Boolean | Replay flight snapshot for incident reproduction |

---

## 4. Telemetry Alerting & Monitoring

Anonymous client telemetry is ingested at `POST /api/v1/telemetry`:
- **Alert Trigger**: If `errors > 0` exceeds 1% of total sessions in a 5-minute rolling window.
- **Triage Action**: Inspect server logs in Vercel / CloudWatch for WebGL context loss or worker timeouts.
