import { unit, cross, dot, scale } from './math';
import type { RTNFrame, RTNCoords } from '../types/orbital';
import type { Km } from '../types/units';

/**
 * Builds the orthonormal Radial-Transverse-Normal (RTN / Hill) reference frame
 * centered on a reference spacecraft with position r and velocity v.
 *
 * - R (Radial): Unit vector along position vector pointing away from Earth center.
 * - N (Normal): Unit vector normal to orbital plane (along angular momentum vector).
 * - T (Transverse): Unit vector along in-plane velocity direction (completes right-handed system).
 */
export function rtn(r: readonly number[], v: readonly number[]): RTNFrame {
  const R = unit(r);
  const N = unit(cross(r, v));
  const T = cross(N, R);
  return { R, T, N };
}

/**
 * Projects a relative separation vector (rRel = rTarget - rRef) into the RTN frame of rRef.
 *
 * @param rRel Relative separation vector [dx, dy, dz] in km
 * @param rRef Primary asset position vector in km
 * @param vRef Primary asset velocity vector in km/s
 * @returns RTN coordinates { r: Radial, t: Transverse, n: Normal } in km
 */
export function projectRTN(
  rRel: readonly number[],
  rRef: readonly number[],
  vRef: readonly number[]
): RTNCoords {
  const b = rtn(rRef, vRef);
  return {
    r: dot(rRel, b.R) as Km,
    t: dot(rRel, b.T) as Km,
    n: dot(rRel, b.N) as Km,
  };
}

/**
 * Transforms coordinates from RTN basis back to inertial Cartesian coordinates.
 */
export function fromRTN(
  rtnCoords: { r: number; t: number; n: number },
  rRef: readonly number[],
  vRef: readonly number[]
): [number, number, number] {
  const b = rtn(rRef, vRef);
  const rVec = scale(b.R, rtnCoords.r);
  const tVec = scale(b.T, rtnCoords.t);
  const nVec = scale(b.N, rtnCoords.n);
  return [
    rVec[0] + tVec[0] + nVec[0],
    rVec[1] + tVec[1] + nVec[1],
    rVec[2] + tVec[2] + nVec[2],
  ];
}
