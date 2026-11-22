import type { Km, KmPerSecond, EpochMs, Probability, MetersPerSecond, Degrees, Radians } from './units';

export type BodyKind = 'sat' | 'deb';
export type LifecycleState = 'ACTIVE' | 'COLLIDING' | 'DISSOLVING' | 'REMOVED';

export interface StateVector {
  r: [Km, Km, Km];
  v: [KmPerSecond, KmPerSecond, KmPerSecond];
}

export interface SyntheticState {
  r0: [Km, Km, Km];
  v0: [KmPerSecond, KmPerSecond, KmPerSecond];
  t0: EpochMs;
}

export interface SpaceBody {
  name: string;
  norad: number;
  kind: BodyKind;
  rec: any; // satellite.SatRec
  l1: string;
  l2: string;
  inc: Degrees;
  ecc: number;
  mm: Radians; // rad/min
  period: number; // seconds
  alt: Km;
  _synth?: SyntheticState;
  lifecycle?: LifecycleState;
  dissolveProgress?: number;
  impactPos?: [Km, Km, Km];
}

export interface OrbitalElements {
  a: Km;
  ecc: number;
  inc: Degrees;
  raan: Degrees;
  argp: Degrees;
  nu: Degrees;
}

export interface RTNFrame {
  R: [number, number, number];
  T: [number, number, number];
  N: [number, number, number];
}

export interface RTNCoords {
  r: Km;
  t: Km;
  n: Km;
}

export interface ConjunctionApproach {
  tca: EpochMs;
  miss: Km;
  relSpeed: KmPerSecond;
  satR: [Km, Km, Km];
  debR: [Km, Km, Km];
  satV: [KmPerSecond, KmPerSecond, KmPerSecond];
  debV: [KmPerSecond, KmPerSecond, KmPerSecond];
  rt?: RTNCoords;
  pc?: Probability;
  risk?: 'crit' | 'warn' | 'safe';
}

export interface ConjunctionScenario {
  satIndex: number;
  debIndex: number;
  tca: EpochMs;
  leadSec: number;
  targetMiss: Km;
  origDeb: SpaceBody;
  synthDeb: SpaceBody;
}

export interface ManeuverPlan {
  axis: 'Along-Track (+T)' | 'Cross-Track (+N)' | 'Radial (+R)' | 'NO SOLUTION';
  dv: MetersPerSecond;
  burnMs: EpochMs;
  leadSec: number;
  postMiss: Km;
  postPc: Probability;
  safe: boolean;
  dvVec: [MetersPerSecond, MetersPerSecond, MetersPerSecond];
}

export interface TLEEntry {
  name: string;
  norad: number;
  l1: string;
  l2: string;
}
