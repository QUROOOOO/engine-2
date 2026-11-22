import * as satellite from 'satellite.js';
import { MU, R_EARTH, DEG2RAD } from './constants';
import { twoBody } from './twoBody';
import type { SpaceBody, StateVector, TLEEntry, BodyKind } from '../types/orbital';
import type { Km, KmPerSecond } from '../types/units';

export const sat: any =
  satellite && (satellite as any).twoline2satrec
    ? satellite
    : typeof window !== 'undefined'
      ? (window as any).satellite
      : satellite;

/**
 * Initializes a SpaceBody record from two-line element strings using SGP4.
 */
export function makeBody(tle: TLEEntry, kind: BodyKind): SpaceBody {
  const rec = sat.twoline2satrec(tle.l1, tle.l2);
  const mmVal = rec.no || rec.no_kozai; // rad/min
  const periodSec = (2 * Math.PI / mmVal) * 60;
  const semiMajorKm = Math.cbrt(MU / Math.pow(mmVal / 60, 2));
  const altKm = semiMajorKm - (R_EARTH as number);

  return {
    name: tle.name.replace(/\s+/g, ' ').trim(),
    norad: tle.norad,
    kind,
    rec,
    l1: tle.l1,
    l2: tle.l2,
    inc: (rec.inclo / DEG2RAD) as any,
    ecc: rec.ecco,
    mm: mmVal as any,
    period: periodSec,
    alt: altKm as Km,
  };
}

/**
 * Propagates a SpaceBody to the specified epoch (ms since Unix epoch).
 * Seamlessly resolves either SGP4 elements or universal Keplerian synthetic states.
 */
export function stateAt(body: SpaceBody, ms: number): StateVector | null {
  if (body && body._synth) {
    return twoBody(body._synth.r0, body._synth.v0, (ms - (body._synth.t0 as number)) / 1000);
  }
  const pv = sat.propagate(body.rec, new Date(ms));
  if (
    !pv ||
    !pv.position ||
    typeof pv.position === 'boolean' ||
    typeof pv.velocity === 'boolean'
  ) {
    return null;
  }

  return {
    r: [pv.position.x, pv.position.y, pv.position.z] as [Km, Km, Km],
    v: [pv.velocity.x, pv.velocity.y, pv.velocity.z] as [KmPerSecond, KmPerSecond, KmPerSecond],
  };
}

/**
 * Computes Greenwich Mean Sidereal Time (GMST) angle in radians for Earth orientation.
 */
export function gmst(ms: number): number {
  return sat.gstime(new Date(ms));
}
