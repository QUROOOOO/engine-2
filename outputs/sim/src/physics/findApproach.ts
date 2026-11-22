import { norm, sub } from './math';
import { stateAt } from './sgp4';
import { projectRTN } from './coordinateTransform';
import type { SpaceBody, ConjunctionApproach } from '../types/orbital';
import type { Km, KmPerSecond, EpochMs } from '../types/units';

/**
 * Searches an orbital catalog propagation window for the closest approach between two SpaceBodies.
 * Uses a two-stage approach:
 * 1. Coarse step sweep (600s) with parabolic peak refinement.
 * 2. Fine golden-section polish to locate the exact TCA to millisecond accuracy.
 *
 * @param satB Protected asset SpaceBody
 * @param debB Debris SpaceBody
 * @param t0 Window start epoch (ms)
 * @param horizonHours Analysis window duration in hours (default: 12h)
 */
export function findApproach(
  satB: SpaceBody,
  debB: SpaceBody,
  t0: number,
  horizonHours = 12
): (ConjunctionApproach & { off: number }) | null {
  const hEnd = horizonHours * 3600;
  const step = 600; // 10-minute coarse steps
  let best: any = { miss: Infinity, t: t0 };
  let prev: any = null;
  let prev2: any = null;

  for (let t = 0; t <= hEnd; t += step) {
    const s = stateAt(satB, t0 + t * 1000);
    const d = stateAt(debB, t0 + t * 1000);
    if (!s || !d) continue;

    const miss = norm(sub(d.r, s.r));
    const cur = { miss, t: t0 + t * 1000, s, d, off: t };
    if (miss < best.miss) best = cur;

    if (prev && prev2) {
      const a = prev2.miss;
      const b = prev.miss;
      const c = cur.miss;
      const den = a - 2 * b + c;
      if (den > 1e-9) {
        const frac = (a - c) / (2 * den);
        if (Math.abs(frac) <= 1) {
          const tt = prev.t + frac * step * 1000;
          const s2 = stateAt(satB, tt);
          const d2 = stateAt(debB, tt);
          if (s2 && d2) {
            const m2 = norm(sub(d2.r, s2.r));
            if (m2 < best.miss) best = { miss: m2, t: tt, s: s2, d: d2, off: (tt - t0) / 1000 };
          }
        }
      }
    }
    prev2 = prev;
    prev = cur;
  }

  // Stage 2: Golden-section polish
  let lo = best.t - step * 1000;
  let hi = best.t + step * 1000;
  const gr = 0.6180339887;
  let x1 = hi - gr * (hi - lo);
  let x2 = lo + gr * (hi - lo);

  const f = (t: number) => {
    const s = stateAt(satB, t);
    const d = stateAt(debB, t);
    return s && d ? norm(sub(d.r, s.r)) : Infinity;
  };

  let f1 = f(x1);
  let f2 = f(x2);
  for (let i = 0; i < 22; i++) {
    if (f1 < f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - gr * (hi - lo);
      f1 = f(x1);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + gr * (hi - lo);
      f2 = f(x2);
    }
  }

  const tt = (lo + hi) / 2;
  const s = stateAt(satB, tt);
  const d = stateAt(debB, tt);

  if (s && d) {
    const rel = sub(d.r, s.r);
    const relV = sub(d.v, s.v);
    const miss = norm(rel);
    if (miss <= best.miss * 1.0005) {
      best = {
        miss,
        t: tt,
        s,
        d,
        rel,
        relV,
        rt: projectRTN(rel, s.r, s.v),
        off: (tt - t0) / 1000,
      };
    }
  }

  if (!best.s || !best.d) return null;

  const rel = best.rel || sub(best.d.r, best.s.r);
  const relV = best.relV || sub(best.d.v, best.s.v);
  const relSpeed = norm(relV);

  return {
    tca: best.t as EpochMs,
    miss: best.miss as Km,
    relSpeed: relSpeed as KmPerSecond,
    satR: best.s.r,
    debR: best.d.r,
    satV: best.s.v,
    debV: best.d.v,
    rt: best.rt || projectRTN(rel, best.s.r, best.s.v),
    off: best.off,
  };
}
