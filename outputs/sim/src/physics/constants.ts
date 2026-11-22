import type { Km, Probability, SceneUnits } from '../types/units';

/** Standard gravitational parameter of Earth in km^3 / s^2 */
export const MU = 398600.4418;

/** Mean volumetric radius of Earth in km (WGS-84 / IERS) */
export const R_EARTH = 6371.0 as Km;

/** NASA/ESA standard keep-out sphere radius in km */
export const SAFE_MISS_KM = 5.0 as Km;

/** Critical collision probability threshold (action required immediately) */
export const PC_CRIT = 1e-3 as Probability;

/** Warning collision probability threshold (conjunction monitoring) */
export const PC_WARN = 1e-4 as Probability;

/** Scene scale: Three.js world units per kilometre */
export const KM = 0.01 as SceneUnits;

/** Degrees to radians conversion factor */
export const DEG2RAD = Math.PI / 180;

/** Radians to degrees conversion factor */
export const RAD2DEG = 180 / Math.PI;
