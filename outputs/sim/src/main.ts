import * as THREE from 'three';
import { SceneView } from './scene';
import { OrbitRig } from './controls';
import { NavGizmo } from './gizmo';
import { UI } from './ui';
import {
  SATS,
  DEBRIS,
  KM,
  makeBody,
  stateAt,
  gmst,
  findApproach,
  deriveEncounter,
  planManeuver,
  twoBody,
  riskOf,
  fetchLiveTles,
  projectRTN,
  pc,
  sat,
  checkSweptCollision,
  computeAvoidanceUnitVector,
  isAvoidanceArrowVisible,
  COLLISION_RADIUS_KM,
  sampleAvoidanceTrajectory,
  type AvoidanceTrajectoryBundle,
} from './physics';
import { ConfigManager } from './config/ConfigManager';
import type { SpaceBody, TLEEntry } from './types/orbital';
import type { Km } from './types/units';

const cfg = ConfigManager.getInstance().get();
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const now0 = (): number => Math.round(Date.now() / 1000) * 1000;

if (!sat) {
  document.body.innerHTML =
    '<div style="padding:40px;font-family:monospace;color:#ece9e3;background:#07080a;height:100vh">SGP4 library failed to load. Check network and reload.</div>';
  throw new Error('satellite.js missing');
}

const viewCanvas = $('view') as HTMLCanvasElement;
const view = new SceneView(viewCanvas);
const webglBanner = $('webglLostBanner');

$('webglReloadBtn')?.addEventListener('click', () => {
  window.location.reload();
});

view.onContextLost = () => {
  S.paused = true;
  if (webglBanner) webglBanner.hidden = false;
  ui.toast('WebGL context lost. Simulation paused.');
};

view.onContextRestored = () => {
  if (webglBanner) webglBanner.hidden = true;
  buildCatalog(SATS, DEBRIS, S.live);
  S.paused = false;
  ui.toast('WebGL context restored.');
};

const ui = new UI({
  select: (kind, index) => selectObject(kind, index, true),
  step: (what, dir) => changeCount(what, dir),
  rate: r => {
    S.rate = r;
  },
  pause: () => togglePause(),
  execute: () => executeBurn(),
  theme: () => {
    ui.setTheme(document.documentElement.dataset.theme !== 'light');
  },
  toggleAutoFollow: enabled => {
    S.autoFollow = enabled;
  },
  toggleAutoDodge: enabled => {
    S.autoDodgeEnabled = enabled;
  },
  testCrash: () => triggerTestCrash(),
  cinema: () => {},
  returnToEarth: () => {
    S.follow = false;
    rig.resetToPlanetView();
  },
});

const rig = new OrbitRig(view.camera, viewCanvas, () => {});
rig.onModeChange = telemetry => {
  ui.setCameraTelemetry(telemetry);
};
rig.onSelectIndex = (kind, index) => selectObject(kind, index, true);
rig.onTogglePause = () => togglePause();
rig.onToggleCinema = () => ui.toggleCinema();
rig.onFocusConjunction = () => focusThreat();

const gizmoContainer = $('gizmoContainer');
const gizmo = gizmoContainer ? new NavGizmo({ container: gizmoContainer, camera: view.camera, rig }) : null;

$('gizmoReset')?.addEventListener('click', () => {
  S.follow = false;
  rig.resetToPlanetView();
});

const ecoBtn = $('ecoBtn');
if (ecoBtn) {
  ecoBtn.addEventListener('click', () => {
    S.ecoMode = !S.ecoMode;
    view.setEcoMode(S.ecoMode);
    ecoBtn.textContent = S.ecoMode ? 'ECO: ON' : 'ECO';
    ecoBtn.setAttribute('aria-pressed', S.ecoMode ? 'true' : 'false');
    ui.toast(S.ecoMode ? 'Eco Mode Enabled (30 FPS, 1.0x DPR)' : 'High Performance Enabled (60 FPS, HiDPI)');
  });
}

interface SimState {
  t0: number;
  simMs: number;
  rate: number;
  paused: boolean;
  satN: number;
  debN: number;
  fuel: number[];
  burns: (any | null)[];
  sel: { kind: 'sat' | 'deb'; index: number };
  scenarios: any[];
  approaches: any[][];
  risks: ('crit' | 'warn' | 'safe')[];
  primary: number;
  plan: any | null;
  ev: any | null;
  windowMin: number;
  live: boolean;
  sats: SpaceBody[];
  debris: SpaceBody[];
  prev: number;
  follow: boolean;
  autoFollow: boolean;
  autoDodgeEnabled: boolean;
  collisionTriggered?: boolean;
  focusDist: number;
  manualPan?: boolean;
  encounterState: 'nominal' | 'approaching' | 'burning' | 'cleared';
  lastCycleMs: number;
  ecoMode: boolean;
}

const S: SimState = {
  t0: now0(),
  simMs: now0(),
  rate: 5,
  paused: false,
  satN: 5,
  debN: 200,
  fuel: Array(15).fill(cfg.simulation.defaultFuelMs || 25),
  burns: Array(15).fill(null),
  sel: { kind: 'sat', index: 0 },
  scenarios: [],
  approaches: [],
  risks: [],
  primary: 0,
  plan: null,
  ev: null,
  windowMin: 15,
  live: false,
  sats: [],
  debris: [],
  prev: performance.now(),
  follow: true,
  autoFollow: true,
  autoDodgeEnabled: true,
  collisionTriggered: false,
  focusDist: cfg.camera.focusDist || 24,
  encounterState: 'nominal',
  lastCycleMs: now0(),
  ecoMode: false,
};

function triggerTestCrash(): void {
  const sat = S.sats[S.primary];
  const sc = scenarioFor(S.primary);
  const deb = S.debris[sc ? sc.debIndex : 0];
  if (!sat || !deb) return;

  // Synthesize direct kinetic intercept (miss distance 0.04 km <= 0.08 km)
  const directEv = deriveEncounter(sat, deb, S.simMs + 14000, 0.42, 0.04);
  if (directEv) {
    S.ev = directEv;
    if (sc) {
      sc.ev = directEv;
      sc.derived = true;
    }
    S.t0 = directEv.tca - 14000;
    S.simMs = S.t0;
    S.prev = performance.now();
    S.burns[S.primary] = null;
    S.collisionTriggered = false;
    S.encounterState = 'approaching';
    S.autoDodgeEnabled = false;
    ui.setAutoDodgeState(false);
    ui.setLivePill('⚠️ Direct Intercept Course · Auto-Dodge DISABLED', 'alert');
    ui.toast('SIMULATING DIRECT COLLISION');

    const satSt = stateAt(sat, S.simMs);
    if (satSt) {
      const p = scenePos(satSt.r);
      rig.focusOnObject(p, sat.name, 'sat', S.primary, 4.2, p.clone().normalize());
      S.follow = true;
    }
  }
}

function init(): void {
  (window as any).__sim = {
    state: S,
    exportState: () => JSON.stringify(S),
    importState: (json: string): boolean => {
      try {
        const obj = JSON.parse(json);
        Object.assign(S, obj);
        return true;
      } catch {
        return false;
      }
    },
  };

  buildCatalog(SATS, DEBRIS, false);
  view.resize();
  ui.setLoading(false);
  ui.setTheme(false);
  ui.setRate(S.rate);

  requestAnimationFrame(loop);
  refreshLive();
}

function buildCatalog(earthEntries: TLEEntry[], debrisEntries: TLEEntry[], live: boolean): void {
  S.sats = earthEntries.slice(0, 15).map(e => makeBody(e, 'sat'));
  S.debris = debrisEntries.map(e => makeBody(e, 'deb'));
  S.satN = Math.min(Math.max(S.satN, 5), S.sats.length);
  S.debN = Math.min(Math.max(S.debN, 50), S.debris.length);
  S.fuel = Array(S.sats.length).fill(cfg.simulation.defaultFuelMs || 25);
  S.burns = Array(S.sats.length).fill(null);
  S.approaches = [];
  S.scenarios = [];
  S.live = live;

  const age = tleAge(S.sats[0]);
  ui.setSource(age, live);
  view.build(S.sats, S.debris, stateAt, S.t0);
  ensureScenarios();
}

function tleAge(body: SpaceBody): number {
  if (!body) return NaN;
  const yy = +body.l1.slice(18, 20);
  const doy = +body.l1.slice(20, 32);
  const yr = yy < 57 ? 2000 + yy : 1900 + yy;
  const ms = Date.UTC(yr, 0, 1) + (doy - 1) * 86400000;
  return (now0() - ms) / 86400000;
}

function computeApproaches(satIndex: number): any[] {
  const out: any[] = [];
  const satB = S.sats[satIndex];
  if (!satB) return out;
  const maxDeb = Math.min(S.debN, S.debris.length);
  for (let i = 0; i < maxDeb; i++) {
    const debB = S.debris[i];
    // Astrodynamic orbital shell pre-filter:
    // Prune debris whose nominal altitude difference exceeds 200 km unless synthetic encounter target
    if (satB.alt && debB.alt && Math.abs(satB.alt - debB.alt) > 200 && !(debB as any)._synth) {
      continue;
    }
    const ev = findApproach(satB, debB, S.t0, 12);
    if (ev && isFinite(ev.miss)) out.push({ debIndex: i, ev });
  }
  // Fallback in case altitude pre-filtering yielded zero candidates (e.g. custom or sparse catalogs)
  if (out.length === 0 && maxDeb > 0) {
    for (let i = 0; i < Math.min(10, maxDeb); i++) {
      const ev = findApproach(satB, S.debris[i], S.t0, 12);
      if (ev && isFinite(ev.miss)) out.push({ debIndex: i, ev });
    }
  }
  out.sort((a, b) => a.ev.miss - b.ev.miss);
  S.approaches[satIndex] = out;
  return out;
}

function ensureScenarios(): void {
  const used = new Set<number>();
  S.scenarios = [];

  for (let i = 0; i < S.satN; i++) {
    const list = S.approaches[i] || computeApproaches(i);
    const candidate = list.find((a: any) => !used.has(a.debIndex)) || list[0];
    if (!candidate) continue;

    let ev = candidate.ev;
    let derived = !!ev.derived;
    const deb = S.debris[candidate.debIndex];

    // Ensure encounter crosses into the < 5 km keep-out corridor for high-impact educational demonstration
    if (ev.miss > 2.0 && !(deb as any)._derived) {
      const d = deriveEncounter(S.sats[i], deb, S.t0, 0.42);
      if (d) {
        d.derived = true;
        ev = d;
        candidate.ev = d;
        derived = true;
        (deb as any)._derived = true;
      }
    }
    if (!ev) continue;
    used.add(candidate.debIndex);
    S.scenarios.push({ satIndex: i, debIndex: candidate.debIndex, ev, derived });
  }

  S.risks = S.debris.map((_, i) => {
    let miss = Infinity;
    let p = 0;
    for (const sc of S.scenarios) {
      for (const a of S.approaches[sc.satIndex] || []) {
        if (a.debIndex !== i) continue;
        if (a.ev.miss < miss) {
          miss = a.ev.miss;
          p = pc(a.ev.rt.t, a.ev.rt.n, (a.ev.t - S.t0) / 3600000);
        }
      }
    }
    if (!isFinite(miss)) return 'safe';
    return riskOf(miss, p);
  });

  view.setDebrisColors(S.risks);

  const sc = S.scenarios[0];
  if (sc) {
    S.primary = sc.satIndex;
    S.ev = sc.ev;
    // Position simulation time 40 seconds prior to encounter for continuous progression
    S.t0 = sc.ev.t - 40000;
    S.simMs = S.t0;
    S.prev = performance.now();
  }

  ui.setCatalog(S.sats.slice(0, S.satN), S.debris.slice(0, S.debN), S.risks);
  ui.setCounts(S.satN, S.debN);
  view.setCounts(S.satN, S.debN);
  ui.setSelection(S.sel);

  S.plan = null;
  ui.setPlan(null, S.fuel[S.primary]);

  if (S.sats[S.primary]) {
    const st0 = stateAt(S.sats[S.primary], S.simMs);
    if (st0) {
      view.focusOn(st0.r, S.focusDist);
    }
  }
}

function scenarioFor(satIndex: number): any {
  return S.scenarios.find(s => s.satIndex === satIndex) || S.scenarios[0] || null;
}

async function refreshLive(): Promise<void> {
  const live = await fetchLiveTles();
  if (!live) {
    ui.toast('Using cached TLE catalog');
    return;
  }
  const earth = live.earth.slice(0, 15);
  if (earth.length < 1) {
    ui.toast('Using cached TLE catalog');
    return;
  }
  S.t0 = now0();
  buildCatalog(earth, live.debris, true);
  ui.toast('LIVE LEO CATALOG LOADED');
}

function changeCount(what: string, dir: number): void {
  if (what === 'sat') {
    const n = Math.min(S.sats.length, Math.max(1, S.satN + dir));
    if (n === S.satN) return;
    S.satN = n;
    ui.setCounts(S.satN, S.debN);
    view.setCounts(S.satN, S.debN);
    ui.setLoading(true);
    setTimeout(() => {
      ensureScenarios();
      ui.setLoading(false);
    }, 40);
  } else {
    const n = Math.min(S.debris.length, Math.max(50, S.debN + dir * 25));
    if (n === S.debN) return;
    S.debN = n;
    ui.setCounts(S.satN, S.debN);
    view.setCounts(S.satN, S.debN);
  }
}

function selectObject(kind: 'sat' | 'deb', index: number, focus: boolean): void {
  if (kind === 'sat' && index >= S.satN) kind = 'deb';
  S.sel = { kind, index };
  ui.setSelection(S.sel);

  const body = kind === 'sat' ? S.sats[index] : S.debris[index];
  if (body) {
    if (kind === 'sat') {
      const sc = scenarioFor(index);
      if (sc) {
        S.primary = index;
        S.ev = sc.ev;
      }
    }
    if (focus) {
      const st = stateAt(body, S.simMs);
      if (st) {
        const p = scenePos(st.r);
        const d = kind === 'sat' ? 4.2 : 3.2;
        view.focusOn(st.r, d);
        rig.focusOnObject(p, body.name, kind, index, d, p.clone().normalize());
        S.follow = true;
      }
    }
  }
}

const scenePos = (r: number[]): THREE.Vector3 => new THREE.Vector3(r[0] * KM, r[2] * KM, -r[1] * KM);

function focusThreat(): void {
  const sc = scenarioFor(S.primary);
  if (sc && typeof sc.debIndex === 'number') {
    selectObject('deb', sc.debIndex, true);
  }
}

function focusSelected(): void {
  if (!S.sel) return;
  const body = S.sel.kind === 'sat' ? S.sats[S.sel.index] : S.debris[S.sel.index];
  const st = body && stateAt(body, S.simMs);
  if (!st || !body) return;
  const p = scenePos(st.r);
  const d = S.sel.kind === 'sat' ? 4.2 : 3.2;
  view.focusOn(st.r, d);
  rig.focusOnObject(p, body.name, S.sel.kind, S.sel.index, d, p.clone().normalize());
  S.follow = true;
}

rig.onFocus = focusSelected;
rig.onPan = () => {
  S.follow = false;
  S.manualPan = true;
};
rig.onDblClick = (nx, ny) => {
  const i = view.pickSat(nx, ny);
  if (i !== null) {
    selectObject('sat', i, true);
    return;
  }
  const hit = pickDebris(nx, ny);
  if (hit !== null) selectObject('deb', hit, true);
};

function pickDebris(nx: number, ny: number): number | null {
  let best: number | null = null;
  let bestD = 18;
  const px = (nx * 0.5 + 0.5) * viewCanvas.clientWidth;
  const py = (-ny * 0.5 + 0.5) * viewCanvas.clientHeight;
  const maxDeb = Math.min(S.debN, S.debris.length);
  for (let i = 0; i < maxDeb; i++) {
    const st = stateAt(S.debris[i], S.simMs);
    if (!st) continue;
    const s = view.worldToScreen(st.r);
    if (s.z > 1) continue;
    const d = Math.hypot(s.x - px, s.y - py);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

viewCanvas.addEventListener('click', e => {
  if (e.button !== 0) return;
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
  const i = view.pickSat(nx, ny);
  if (i !== null) {
    selectObject('sat', i, false);
    return;
  }
  const d = pickDebris(nx, ny);
  if (d !== null) selectObject('deb', d, false);
});

function togglePause(): void {
  S.paused = !S.paused;
  ui.setPaused(S.paused);
}

function executeBurn(): void {
  const sc = scenarioFor(S.primary);
  if (!sc || !S.plan) return;
  const plan = S.plan;

  // Realistic calibrated burn in m/s (plan.dv is already in m/s!)
  const at = Math.max(S.simMs, plan.burnMs);
  S.fuel[S.primary] = Math.max(0, S.fuel[S.primary] - plan.dv);
  S.burns[S.primary] = { plan, at, fired: false, satIndex: S.primary };

  ui.toast(`BURNING ENGINE · ${plan.short} · ${plan.dv.toFixed(2)} m/s`);
  ui.setPlan(plan, S.fuel[S.primary], 'MANEUVER EXECUTED');
  view.firePlume(S.primary);
}

function updatePlan(sc: any): void {
  if (!sc) {
    ui.setPlan(null, S.fuel[S.primary]);
    return;
  }
  if (S.burns[S.primary]) return;

  const dtTca = (S.ev.t - S.simMs) / 1000; // seconds to TCA
  if (dtTca <= 0) {
    ui.setPlan(null, S.fuel[S.primary]);
    return;
  }

  const plan = planManeuver(S.sats[sc.satIndex], S.debris[sc.debIndex], S.ev, S.simMs, S.fuel[sc.satIndex]);
  S.plan = plan;
  ui.setPlan(plan, S.fuel[sc.satIndex]);
}

function updateThreat(sc: any): void {
  if (!sc) return;
  const burn = S.burns[sc.satIndex];
  let miss = sc.ev.miss;
  let rt = sc.ev.rt;
  let relSpeed = sc.ev.relSpeed;

  if (burn && S.simMs >= burn.at) {
    const post = twoBody(burn.plan.r0, burn.plan.v0, (S.ev.t - burn.at) / 1000);
    const d = stateAt(S.debris[sc.debIndex], S.ev.t);
    if (d) {
      const rel = [d.r[0] - post.r[0], d.r[1] - post.r[1], d.r[2] - post.r[2]];
      const relV = [d.v[0] - post.v[0], d.v[1] - post.v[1], d.v[2] - post.v[2]];
      miss = Math.hypot(...rel);
      rt = projectRTN(rel, post.r, post.v);
      relSpeed = Math.hypot(...relV);
    }
  }

  const tcaSec = (S.ev.t - S.simMs) / 1000;
  const tcaMin = tcaSec / 60;
  const isDanger = miss < 5.0;

  ui.setThreat({
    sat: S.sats[sc.satIndex].name,
    deb: S.debris[sc.debIndex].name,
    miss,
    rt,
    relSpeed,
    tcaMin,
    risk: isDanger ? 'crit' : 'safe',
    debIndex: sc.debIndex,
  });

  // Calculate mathematically coupled dual 3D trajectory paths (Blue default path + Green Engine 2 avoidance path)
  if (isDanger && S.sats[sc.satIndex] && S.plan) {
    if (!currentAvoidanceBundle || currentAvoidanceSatIndex !== sc.satIndex) {
      currentAvoidanceBundle = sampleAvoidanceTrajectory(
        S.sats[sc.satIndex],
        S.plan,
        S.ev.t,
        18.0,
        96
      );
      currentAvoidanceSatIndex = sc.satIndex;
    }
    view.setDualPaths(
      currentAvoidanceBundle.defaultPoints,
      currentAvoidanceBundle.avoidPoints,
      null,
      sc.satIndex
    );
  } else if (!isDanger) {
    currentAvoidanceBundle = null;
    currentAvoidanceSatIndex = -1;
    view.clearDualPaths();
  }
}

let isTabHidden = document.hidden;
document.addEventListener('visibilitychange', () => {
  isTabHidden = document.hidden;
  if (!isTabHidden) {
    S.prev = performance.now();
    lastFrameTime = performance.now();
    requestAnimationFrame(loop);
  }
});

let _frames = 0;
let _fpsT = performance.now();
let lastFrameTime = performance.now();
let lastDomUpdateTime = 0;
let lastSatPositions: [number, number, number][] = [];
let lastDebPositions: [number, number, number][] = [];
let currentAvoidanceBundle: AvoidanceTrajectoryBundle | null = null;
let currentAvoidanceSatIndex: number = -1;
const prevCamPos = new THREE.Vector3();
const prevCamTarget = new THREE.Vector3();

function loop(now: number): void {
  if (isTabHidden) {
    return;
  }

  // Adaptive FPS: 30 FPS in Eco mode (~33ms), 60 FPS in normal mode (~16ms)
  const targetInterval = S.ecoMode ? 32.5 : 16.0;
  const elapsed = now - lastFrameTime;
  if (elapsed < targetInterval) {
    requestAnimationFrame(loop);
    return;
  }
  lastFrameTime = now;

  const dtReal = Math.max(0, Math.min(0.08, (now - S.prev) / 1000 || 0.016));
  S.prev = now;

  rig.update(dtReal);

  if (!S.paused) S.simMs += dtReal * 1000 * S.rate;

  const sc = scenarioFor(S.primary);
  if (sc) S.ev = sc.ev;

  // Propagate Satellites
  const satStates: any[] = [];
  const satVel: (number[] | null)[] = [];
  const satLifecycles = S.sats.map(s => s.lifecycle || 'ACTIVE');

  for (let i = 0; i < S.satN; i++) {
    let st: any = stateAt(S.sats[i], S.simMs);
    const burn = S.burns[i];
    if (st && burn && S.simMs >= burn.at) {
      if (!burn.fired) {
        burn.fired = true;
        view.firePlume(i);
      }
    }

    let satV = st ? st.v : null;

    // Mathematical coupling: satellite travels directly on the green curve during dodge!
    if (currentAvoidanceBundle && currentAvoidanceSatIndex === i && S.autoDodgeEnabled) {
      const evalRes = currentAvoidanceBundle.evaluateAt(S.simMs);
      if (evalRes.inDodgeWindow) {
        if (st) {
          st = { ...st, rScene: evalRes.pos };
        }
        satV = evalRes.defaultDir;
      }
    }

    satStates[i] = st;
    satVel[i] = satV;
  }

  // Propagate Debris with position and velocity
  const debPos: (number[] | null)[] = [];
  const debVel: (number[] | null)[] = [];
  const debrisUpdated = true;

  for (let i = 0; i < S.debN; i++) {
    const st = stateAt(S.debris[i], S.simMs);
    debPos[i] = st ? st.r : null;
    debVel[i] = st ? st.v : null;
  }

  // Continuous Proximity Detection & Physical Impact Loop (Swept CCD to prevent tunneling)
  if (sc && S.sats[sc.satIndex] && S.debris[sc.debIndex]) {
    const satObj = S.sats[sc.satIndex];
    const debObj = S.debris[sc.debIndex];
    const satSt = satStates[sc.satIndex];
    const debSt = stateAt(debObj, S.simMs);

    if (satSt && debSt && (satObj.lifecycle === 'ACTIVE' || !satObj.lifecycle)) {
      const prevSat = lastSatPositions[sc.satIndex] || satSt.r;
      const prevDeb = lastDebPositions[sc.debIndex] || debSt.r;

      const { colliding, impactPosKm } = checkSweptCollision(
        prevSat,
        satSt.r,
        prevDeb,
        debSt.r,
        COLLISION_RADIUS_KM
      );

      const tcaSecDirect = (S.ev.t - S.simMs) / 1000;
      const atTcaDirect = Math.abs(tcaSecDirect) <= 1.2 && (sc.ev?.miss || 1.0) <= COLLISION_RADIUS_KM;

      const burn = S.burns[sc.satIndex];
      const burnFired = burn && burn.fired;

      if ((colliding || atTcaDirect) && !burnFired && !S.collisionTriggered) {
        S.collisionTriggered = true;
        satObj.lifecycle = 'COLLIDING';
        debObj.lifecycle = 'COLLIDING';
        satObj.impactPos = impactPosKm as [Km, Km, Km];
        debObj.impactPos = impactPosKm as [Km, Km, Km];

        ui.setLivePill('💥 Impact Confirmed — Satellite & Debris Destroyed', 'alert');
        ui.toast('💥 KINETIC IMPACT · SATELLITE DESTROYED');

        view.triggerCollisionEffect(impactPosKm, sc.satIndex, sc.debIndex, () => {
          satObj.lifecycle = 'REMOVED';
          debObj.lifecycle = 'REMOVED';
          ui.setCatalog(S.sats.slice(0, S.satN), S.debris.slice(0, S.debN), S.risks);
          ui.setCounts(S.satN, S.debN);
          setTimeout(() => {
            rig.resetToPlanetView();
          }, 1800);
        });
      }
    }
  }

  // Dual Vector Arrows: Calculate Post-Burn Avoidance Vector & Smart Visibility
  let avoidanceVec: [number, number, number] | null = null;
  if (currentAvoidanceBundle && S.primary === currentAvoidanceSatIndex) {
    const evalRes = currentAvoidanceBundle.evaluateAt(S.simMs);
    avoidanceVec = evalRes.avoidDir; // Exact tangent of the green avoidance curve!
  } else if (S.plan && satStates[S.primary]) {
    avoidanceVec = computeAvoidanceUnitVector(satStates[S.primary].v, S.plan.dvVec || [0, 1.8, 0]);
  }
  const isEncounterAlert = S.encounterState === 'approaching' || S.encounterState === 'burning';
  const isInspectingSat = rig.isInspectingObject('sat', S.primary);
  const avoidanceVisible = isAvoidanceArrowVisible({
    isEncounterActive: isEncounterAlert,
    hasPlan: S.plan !== null && S.plan.axis !== 'NO SOLUTION',
    isCameraFocusedOnSat: isInspectingSat,
    satLifecycle: S.sats[S.primary]?.lifecycle,
  });

  const threatIdx = sc ? sc.debIndex : -1;
  view.update({
    sats: satStates,
    debris: debPos,
    ts: S.simMs,
    gmstAngle: gmst(S.simMs),
    threatIdx: threatIdx < S.debN ? threatIdx : -1,
    threatPos: sc ? stateAt(S.debris[sc.debIndex], S.simMs)?.r || null : null,
    selected: { sat: S.sel.kind === 'sat' ? S.sel.index : S.primary },
    debrisUpdated,
    dtReal,
    satVelocities: satVel,
    debrisVelocities: debVel,
    avoidanceVec,
    avoidanceVisible,
    satLifecycles,
  });

  // Continuous Autonomous Event Choreography & Live State Machine
  if (sc && S.ev) {
    const tcaSec = (S.ev.t - S.simMs) / 1000;
    const satName = S.sats[sc.satIndex]?.name || 'Satellite';
    const debName = S.debris[sc.debIndex]?.name || 'Debris';

    // Step A: Approaching danger zone (T-40s to T-15s)
    if (tcaSec > 15 && tcaSec <= 40) {
      if (S.encounterState !== 'approaching') {
        S.encounterState = 'approaching';
        ui.setLivePill(`⚠️ Collision Course Detected · ${satName} & ${debName}`, 'alert');
        if (S.autoFollow) {
          const satSt = satStates[sc.satIndex];
          if (satSt) {
            const p = scenePos(satSt.r);
            rig.focusOnObject(p, satName, 'sat', sc.satIndex, 4.2, p.clone().normalize());
          }
        }
      }
    }
    // Step B: Burn execution & thrust arrow (T-15s to T-2s)
    else if (tcaSec > 2 && tcaSec <= 15) {
      if (S.encounterState !== 'burning') {
        S.encounterState = 'burning';
        if (S.autoDodgeEnabled) {
          if (!S.burns[sc.satIndex]) {
            executeBurn();
          }
          ui.setLivePill(`Autonomous Burn Executed · ${S.plan?.short || '+N'} (+${(S.plan?.dv || 1.85).toFixed(2)} m/s)`, 'alert');
        } else {
          ui.setLivePill(`⚠️ Direct Intercept Course · Auto-Dodge OFF · T-${Math.round(tcaSec)}s`, 'alert');
        }
      }
    }
    // Step C: TCA Passage & Safe Clearance Achieved (T <= 2s to T+10s)
    else if (tcaSec <= 2 && tcaSec > -12) {
      if (S.encounterState !== 'cleared') {
        S.encounterState = 'cleared';
        if (
          S.collisionTriggered ||
          S.sats[sc.satIndex]?.lifecycle === 'COLLIDING' ||
          S.sats[sc.satIndex]?.lifecycle === 'DISSOLVING' ||
          S.sats[sc.satIndex]?.lifecycle === 'REMOVED'
        ) {
          ui.setLivePill('💥 Impact Confirmed — Satellite & Debris Destroyed', 'alert');
        } else {
          const postDist = S.plan?.postMiss ? Number(S.plan.postMiss).toFixed(2) : '7.80';
          ui.setLivePill(`✓ Safe Clearance Achieved (${postDist} km) · All Systems Nominal`, 'safe');
        }
      }
    }
    // Step D: Reset and cycle smoothly to the next encounter! Never freeze!
    else if (tcaSec <= -12) {
      S.encounterState = 'nominal';
      S.collisionTriggered = false;
      currentAvoidanceBundle = null;
      currentAvoidanceSatIndex = -1;
      view.clearDualPaths();
      ui.setLivePill('All Systems Nominal · Scanning LEO Orbit', 'nominal');

      // Schedule next encounter for the next satellite in the constellation
      S.primary = (S.primary + 1) % S.satN;
      S.burns[S.primary] = null;
      const nextSat = S.sats[S.primary];
      const nextDebIdx = Math.floor(Math.random() * Math.min(S.debN, S.debris.length));
      const nextDeb = S.debris[nextDebIdx];

      if (nextSat && nextDeb) {
        const newEv = deriveEncounter(nextSat, nextDeb, S.simMs + 35000, 0.45);
        if (newEv) {
          S.ev = newEv;
          S.scenarios[0] = { satIndex: S.primary, debIndex: nextDebIdx, ev: newEv, derived: true };
        }
      }

      if (S.autoFollow) {
        rig.resetToPlanetView();
      }
    }
  }

  // Smooth Camera Target Follow in OBJECT_CENTRIC Mode
  if (S.follow && !rig.manualPan && rig.frameMode === 'OBJECT_CENTRIC') {
    const fb = S.sel.kind === 'sat' ? S.sats[S.sel.index] : S.debris[S.sel.index];
    const fs = fb && stateAt(fb, S.simMs);
    if (fs) rig.updateTrackedPosition(scenePos(fs.r));
  }

  // DOM updates throttled to 10 Hz (100ms) to eliminate DOM recalculation & layout thrashing
  if (now - lastDomUpdateTime >= 100) {
    lastDomUpdateTime = now;
    ui.setClock({
      met: met(S.simMs - S.t0),
    });

    ui.setCameraTelemetry({
      frameMode: rig.frameMode,
      targetName: rig.targetName,
      distance: rig.currentDistance,
      isTransitioning: rig.isTransitioning,
    });

    updateThreat(sc);
    updatePlan(sc);
  }

  if (view.camera !== rig.cam) {
    view.camera = rig.cam as THREE.PerspectiveCamera;
    if (gizmo) gizmo.setCamera(rig.cam);
  }

  // On-demand rendering: when paused and camera is at rest with no active collisions, skip render calls
  const isTransitioning = rig.isTransitioning || rig.manualPan;
  const hasActiveCollisions = view.activeCollisionCount > 0;
  const camMoved = prevCamPos.distanceToSquared(view.camera.position) > 1e-6 ||
                   prevCamTarget.distanceToSquared(rig.target) > 1e-6;

  const shouldRender = !S.paused || isTransitioning || hasActiveCollisions || camMoved;
  if (shouldRender) {
    prevCamPos.copy(view.camera.position);
    prevCamTarget.copy(rig.target);
    view.render();
    if (gizmo) gizmo.update();
  }

  _frames++;
  if (now - _fpsT > 1000) {
    _frames = 0;
    _fpsT = now;
  }

  lastSatPositions = satStates.map(st => (st ? [st.r[0], st.r[1], st.r[2]] : [0, 0, 0]));
  lastDebPositions = debPos.map(p => (p ? [p[0], p[1], p[2]] : [0, 0, 0]));

  requestAnimationFrame(loop);
}

function met(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

addEventListener('resize', () => view.resize());
new ResizeObserver(() => view.resize()).observe($('stage'));

init();
