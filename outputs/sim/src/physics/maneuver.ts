import { SAFE_MISS_KM, PC_WARN } from './constants';
import { norm, sub, scale } from './math';
import { rtn, projectRTN } from './coordinateTransform';
import { twoBody } from './twoBody';
import { stateAt } from './sgp4';
import { pc } from './collisionProbability';
import type { SpaceBody } from '../types/orbital';
import type { MetersPerSecond, Km, EpochMs, Probability } from '../types/units';

export interface ManeuverAxisDefinition {
  key: 'ALONG-TRACK' | 'CROSS-TRACK' | 'RADIAL';
  short: string;
  ix: number; // Index in [R, T, N]
  gain: (n: number, leadSec: number) => number;
}

/**
 * Clohessy-Wiltshire (Hill-Clohessy-Wiltshire) linear relative motion gain functions.
 */
export const AXES: ManeuverAxisDefinition[] = [
  {
    key: 'ALONG-TRACK',
    short: 'AT',
    ix: 1, // T-axis
    gain: (n, t) => 2 * (1 - Math.cos(n * t)),
  },
  {
    key: 'CROSS-TRACK',
    short: 'CT',
    ix: 2, // N-axis
    gain: (n, t) => Math.abs(Math.sin(n * t)),
  },
  {
    key: 'RADIAL',
    short: 'RD',
    ix: 0, // R-axis
    gain: (n, t) => 1 - Math.cos(n * t),
  },
];

export interface PlannedCandidate {
  axis: 'Along-Track (+T)' | 'Cross-Track (+N)' | 'Radial (+R)' | 'NO SOLUTION';
  axisKey: string;
  short: string;
  dv: MetersPerSecond; // in m/s
  leadSec: number;
  burnMs: EpochMs;
  burned: boolean;
  postMiss: Km;
  postPc: Probability;
  safe: boolean;
  dvVec: [MetersPerSecond, MetersPerSecond, MetersPerSecond];
  r0: [number, number, number];
  v0: [number, number, number];
  rt: { r: Km; t: Km; n: Km };
  note?: string;
  requiredDv?: number;
}

/**
 * Plans an optimal collision avoidance maneuver (CAM) within fuel and timeline constraints.
 *
 * @param satB Primary protected asset SpaceBody
 * @param debB Conjunction debris SpaceBody
 * @param ev Encounter metadata with tca and initial miss
 * @param nowMs Current simulation time in ms
 * @param fuelMps Available delta-v fuel budget in m/s
 */
export function planManeuver(
  satB: SpaceBody,
  debB: SpaceBody,
  ev: { tca?: number; t?: number; miss: number },
  nowMs: number,
  fuelMps: number
): PlannedCandidate | null {
  const tcaEpoch = ev.tca || ev.t || 0;
  const dtTca = (tcaEpoch - nowMs) / 1000; // seconds to TCA
  if (dtTca <= 60) return null;

  const mm = satB.rec.no || satB.rec.no_kozai;
  const n = mm / 60; // mean motion in rad/s

  const gap = Math.max(0, (SAFE_MISS_KM as number) + 0.25 - ev.miss);
  const fuelKms = fuelMps / 1000; // convert m/s to km/s
  const cands: PlannedCandidate[] = [];

  // Evaluate lead burn fractions
  for (const frac of [0.45, 0.65, 0.82]) {
    const lead = Math.max(60, Math.min(dtTca - 60, dtTca * frac));
    if (lead <= 0) continue;
    const burnMs = (nowMs + lead * 1000) as EpochMs;
    const bs = stateAt(satB, burnMs as number);
    if (!bs) continue;

    const b = rtn(bs.r, bs.v);
    const basis = [b.R, b.T, b.N];

    for (const ax of AXES) {
      const g = ax.gain(n, lead);
      if (g < 0.02) continue;

      let dvKms = Math.max(0.00005, (gap * n) / g); // km/s
      const requiredDvKms = dvKms;
      dvKms = Math.min(dvKms, fuelKms);
      if (dvKms < 1e-7) continue;

      const dvVecKms = scale(basis[ax.ix], dvKms);
      const vsKms: [number, number, number] = [
        bs.v[0] + dvVecKms[0],
        bs.v[1] + dvVecKms[1],
        bs.v[2] + dvVecKms[2],
      ];

      const nominalPost = twoBody(bs.r, bs.v, dtTca - lead);
      const post = twoBody(bs.r, vsKms, dtTca - lead);
      const dTc = stateAt(debB, tcaEpoch);
      if (!dTc) continue;

      // Differential displacement from burn isolating thruster impact
      const burnDelta = sub(post.r, nominalPost.r);
      const nominalRel = sub(dTc.r, nominalPost.r);
      const rel = sub(nominalRel, burnDelta);
      const postMiss = norm(rel) as Km;

      const pRTN = projectRTN(rel, post.r, post.v);
      const postPc = pc(pRTN.t, pRTN.n, (dtTca - lead) / 3600);
      const isSafe =
        postMiss >= (SAFE_MISS_KM as number) &&
        postPc < (PC_WARN as number) &&
        requiredDvKms <= fuelKms + 1e-6;

      const axisLabel =
        ax.key === 'ALONG-TRACK'
          ? 'Along-Track (+T)'
          : ax.key === 'CROSS-TRACK'
            ? 'Cross-Track (+N)'
            : 'Radial (+R)';

      cands.push({
        axis: axisLabel as any,
        axisKey: ax.key,
        short: ax.short,
        dv: (dvKms * 1000) as MetersPerSecond,
        leadSec: lead,
        burnMs,
        burned: !isSafe && dvKms >= fuelKms * 0.999,
        postMiss,
        postPc,
        safe: isSafe,
        dvVec: [
          (dvVecKms[0] * 1000) as MetersPerSecond,
          (dvVecKms[1] * 1000) as MetersPerSecond,
          (dvVecKms[2] * 1000) as MetersPerSecond,
        ],
        r0: bs.r,
        v0: vsKms,
        rt: pRTN,
      });
    }
  }

  if (!cands.length) return null;

  // Prefer safe options with minimal fuel delta-v
  const safe = cands.filter(c => c.safe).sort((a, b) => (a.dv as number) - (b.dv as number));
  const pick = safe[0] || cands.sort((a, b) => (b.postMiss as number) - (a.postMiss as number))[0];

  pick.note = safe.length
    ? 'NOMINAL'
    : pick.burned
      ? 'UNSAFE — Δv BUDGET EXHAUSTED'
      : 'UNSAFE — INSUFFICIENT CLEARANCE';

  return pick;
}

export interface AvoidanceTrajectoryEvaluation {
  pos: [number, number, number];
  defaultPos: [number, number, number];
  defaultDir: [number, number, number];
  avoidDir: [number, number, number];
  inDodgeWindow: boolean;
}

export interface AvoidanceTrajectoryBundle {
  defaultPoints: [number, number, number][];
  avoidPoints: [number, number, number][];
  evaluateAt: (simMs: number) => AvoidanceTrajectoryEvaluation;
}

/**
 * Mathematically couples the unmaneuvered ISRO orbit and Engine 2 avoidance trajectory.
 * Guarantees C^1 continuity at burn time, zero-gap branching, and exact tangent tracking.
 *
 * @param satBody Target protected satellite
 * @param burnPlan Candidate maneuver with r0, v0, burnMs
 * @param tcaMs Time of closest approach in epoch ms
 * @param visualScale Magnification factor for human-scale visual clarity (default 18.0)
 * @param samples Number of curve points to sample (default 96)
 */
export function sampleAvoidanceTrajectory(
  satBody: SpaceBody,
  burnPlan: { r0: [number, number, number]; v0: [number, number, number]; burnMs: number },
  tcaMs: number,
  visualScale = 18.0,
  samples = 96
): AvoidanceTrajectoryBundle {
  const KM_TO_SCENE = 0.01;
  const burnMs = burnPlan.burnMs;
  const dtTcaMs = Math.max(1000, tcaMs - burnMs);
  const totalDurationMs = dtTcaMs * 1.6;
  const endMs = burnMs + totalDurationMs;

  const toScene = (rKm: readonly number[]): [number, number, number] => [
    rKm[0] * KM_TO_SCENE,
    rKm[2] * KM_TO_SCENE,
    -rKm[1] * KM_TO_SCENE,
  ];

  const computeStateKm = (t: number) => {
    const defaultState = stateAt(satBody, t);
    const defR: [number, number, number] = defaultState ? defaultState.r : burnPlan.r0;

    if (t <= burnMs) {
      return { defR, avoidR: defR };
    }

    const dtSec = (t - burnMs) / 1000;
    const physState = twoBody(burnPlan.r0, burnPlan.v0, dtSec);
    const physR = physState.r;

    const deltaX = physR[0] - defR[0];
    const deltaY = physR[1] - defR[1];
    const deltaZ = physR[2] - defR[2];
    const deltaNorm = Math.hypot(deltaX, deltaY, deltaZ);

    const u = Math.min(1.0, Math.max(0.0, (t - burnMs) / dtTcaMs));
    const w = 0.5 * (1.0 - Math.cos(Math.PI * u));

    let effScale = visualScale;
    if (deltaNorm > 1e-6 && effScale * deltaNorm > 180.0) {
      effScale = 180.0 / deltaNorm;
    }

    const avoidR: [number, number, number] = [
      defR[0] + deltaX * effScale * w,
      defR[1] + deltaY * effScale * w,
      defR[2] + deltaZ * effScale * w,
    ];

    return { defR, avoidR };
  };

  const defaultPoints: [number, number, number][] = [];
  const avoidPoints: [number, number, number][] = [];

  for (let i = 0; i < samples; i++) {
    const t = burnMs + (totalDurationMs * i) / (samples - 1);
    const { defR, avoidR } = computeStateKm(t);
    defaultPoints.push(toScene(defR));
    avoidPoints.push(toScene(avoidR));
  }

  const evaluateAt = (simMs: number): AvoidanceTrajectoryEvaluation => {
    const deltaMs = 350;
    const { defR, avoidR } = computeStateKm(simMs);
    const pos = toScene(avoidR);
    const defaultPos = toScene(defR);

    // Default orbit tangent:
    const prevDef = computeStateKm(simMs - deltaMs).defR;
    const nextDef = computeStateKm(simMs + deltaMs).defR;
    const dDefX = (nextDef[0] - prevDef[0]) * KM_TO_SCENE;
    const dDefY = (nextDef[2] - prevDef[2]) * KM_TO_SCENE;
    const dDefZ = -(nextDef[1] - prevDef[1]) * KM_TO_SCENE;
    const dDefNorm = Math.hypot(dDefX, dDefY, dDefZ) || 1.0;
    const defaultDir: [number, number, number] = [dDefX / dDefNorm, dDefY / dDefNorm, dDefZ / dDefNorm];

    // Avoidance curve tangent (strictly following the green path):
    const prevAvoid = computeStateKm(simMs - deltaMs).avoidR;
    const nextAvoid = computeStateKm(simMs + deltaMs).avoidR;
    const dAvX = (nextAvoid[0] - prevAvoid[0]) * KM_TO_SCENE;
    const dAvY = (nextAvoid[2] - prevAvoid[2]) * KM_TO_SCENE;
    const dAvZ = -(nextAvoid[1] - prevAvoid[1]) * KM_TO_SCENE;
    const dAvNorm = Math.hypot(dAvX, dAvY, dAvZ) || 1.0;
    const avoidDir: [number, number, number] = [dAvX / dAvNorm, dAvY / dAvNorm, dAvZ / dAvNorm];

    const inDodgeWindow = simMs >= burnMs && simMs <= endMs;

    return {
      pos,
      defaultPos,
      defaultDir,
      avoidDir,
      inDodgeWindow,
    };
  };

  return {
    defaultPoints,
    avoidPoints,
    evaluateAt,
  };
}
