import { MU } from './constants';
import { norm, dot } from './math';
import { stumpffC, stumpffS } from './stumpff';
import type { StateVector } from '../types/orbital';
import type { Km, KmPerSecond } from '../types/units';

/**
 * Propagates an orbital state vector (r0, v0) by dt seconds using the universal variable method.
 * Numerically stable for circular, elliptical, parabolic, and hyperbolic trajectories.
 *
 * @param r0 Initial position vector in km [x, y, z]
 * @param v0 Initial velocity vector in km/s [vx, vy, vz]
 * @param dt Propagation interval in seconds
 * @returns StateVector containing position in km and velocity in km/s
 */
export function twoBody(
  r0: readonly number[],
  v0: readonly number[],
  dt: number
): StateVector {
  const r0n = norm(r0);
  const v0n = norm(v0);
  const sqMu = Math.sqrt(MU);
  const rv = dot(r0, v0);
  const alpha = 2 / r0n - (v0n * v0n) / MU; // 1 / semi-major axis (reciprocal)

  // Initial estimate for universal anomaly chi
  let x = alpha > 1e-9 ? sqMu * alpha * dt : (sqMu * dt) / r0n;

  // Newton-Raphson iteration for universal Kepler's equation
  for (let i = 0; i < 80; i++) {
    const z = x * x * alpha;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const F = (rv / sqMu) * x * x * C + (1 - alpha * r0n) * x * x * x * S + r0n * x - sqMu * dt;
    const dF = (rv / sqMu) * x * (1 - z * S) + (1 - alpha * r0n) * x * x * C + r0n;
    if (Math.abs(dF) < 1e-15) break;
    const dx = F / dF;
    x -= dx;
    if (Math.abs(dx) < 1e-10) break;
  }

  const z = x * x * alpha;
  const C = stumpffC(z);
  const S = stumpffS(z);

  // Lagrange f and g coefficients
  const f = 1 - ((x * x) / r0n) * C;
  const g = dt - ((x * x * x) / sqMu) * S;

  const r: [Km, Km, Km] = [
    (f * r0[0] + g * v0[0]) as Km,
    (f * r0[1] + g * v0[1]) as Km,
    (f * r0[2] + g * v0[2]) as Km,
  ];

  const rn = norm(r);

  // Lagrange f_dot and g_dot coefficients
  const fd = (sqMu / (rn * r0n)) * x * (z * S - 1);
  const gd = 1 - ((x * x) / rn) * C;

  const v: [KmPerSecond, KmPerSecond, KmPerSecond] = [
    (fd * r0[0] + gd * v0[0]) as KmPerSecond,
    (fd * r0[1] + gd * v0[1]) as KmPerSecond,
    (fd * r0[2] + gd * v0[2]) as KmPerSecond,
  ];

  return { r, v };
}
