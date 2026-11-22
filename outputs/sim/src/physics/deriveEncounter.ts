import { MU, R_EARTH, RAD2DEG } from './constants';
import { norm, sub, add, scale, unit, dot } from './math';
import { rtn, projectRTN } from './coordinateTransform';
import { stateAt } from './sgp4';
import type { SpaceBody, ConjunctionApproach } from '../types/orbital';
import type { Km, KmPerSecond, EpochMs } from '../types/units';

/**
 * Derives a synthetic conjunction encounter between a satellite and debris object.
 * Phase-shifts the debris velocity and position so that a close encounter occurs at target TCA.
 * Preserves realistic physical orbital characteristics for both objects.
 *
 * @param satB Protected asset SpaceBody
 * @param debB Debris SpaceBody to modify
 * @param t0 Current simulation epoch ms
 * @param targetHours Time to target TCA in hours (default: 0.22h ~ 13.2 minutes)
 * @param missKm Targeted miss distance in km (default: 0.08 km)
 */
export function deriveEncounter(
  satB: SpaceBody,
  debB: SpaceBody,
  t0: number,
  targetHours = 0.22,
  missKm = 0.08
): (ConjunctionApproach & { derived: boolean }) | null {
  const tcaMs = Math.round(t0 + targetHours * 3600000);
  const s = stateAt(satB, tcaMs);
  if (!s) return null;

  const b = rtn(s.r, s.v);
  const dir = unit(add(scale(b.T, 0.34), add(scale(b.N, 0.92), scale(b.R, 0.18))));
  const relV = scale(dir, 1.6);
  const perp = unit(sub(b.T, scale(dir, dot(b.T, dir))));
  const rel = scale(perp, missKm);

  const dr = add(s.r, rel);
  const dv = add(s.v, relV);
  debB._synth = {
    r0: dr as [Km, Km, Km],
    v0: dv as [KmPerSecond, KmPerSecond, KmPerSecond],
    t0: tcaMs as EpochMs,
  };

  const rn = norm(dr);
  const vn = norm(dv);
  const a = 1 / (2 / rn - (vn * vn) / MU);
  debB.period = 2 * Math.PI * Math.sqrt(Math.pow(Math.abs(a), 3) / MU);
  debB.alt = (a - (R_EARTH as number)) as Km;
  debB.inc = (Math.acos(Math.max(-1, Math.min(1, b.N[2]))) * RAD2DEG) as any;

  const d = stateAt(debB, tcaMs);
  if (!d) return null;

  const rrel = sub(d.r, s.r);
  const vrel = sub(d.v, s.v);
  const missDist = norm(rrel);
  const relSpeed = norm(vrel);

  return {
    tca: tcaMs as EpochMs,
    t: tcaMs,
    miss: missDist as Km,
    relSpeed: relSpeed as KmPerSecond,
    satR: s.r,
    debR: d.r,
    satV: s.v,
    debV: d.v,
    rt: projectRTN(rrel, s.r, s.v),
    derived: true,
  } as any;
}
