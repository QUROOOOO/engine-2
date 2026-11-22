import { describe, it, expect } from 'vitest';
import { pc } from '../../src/physics/collisionProbability';

describe('Foster-Chan B-Plane Collision Probability (Pc)', () => {
  it('yields maximum probability when miss distance is zero', () => {
    const pcZero = pc(0, 0, 1.0);
    const pcOffset = pc(0.1, 0.05, 1.0);
    expect(pcZero).toBeGreaterThan(pcOffset);
    expect(pcZero).toBeLessThanOrEqual(1.0);
    expect(pcZero).toBeGreaterThan(0.0);
  });

  it('decays exponentially as separation exceeds 3-sigma error ellipsoid', () => {
    const pc1Sigma = pc(0.1, 0.05, 1.0);
    const pc5Sigma = pc(1.5, 1.0, 1.0);
    const pc10Sigma = pc(5.0, 5.0, 1.0);

    expect(pc5Sigma).toBeLessThan(pc1Sigma * 1e-4);
    expect(pc10Sigma).toBeLessThan(1e-12);
  });

  it('accurately reproduces numerical Gaussian 2D integral via Monte Carlo validation', () => {
    // Foster-Chan 2D Gaussian density validation:
    // P_c = int_A (1 / (2*pi*sT*sN)) * exp(-0.5*(t^2/sT^2 + n^2/sN^2)) dt dn
    // For small hard body circle of radius r:
    // P_c ~ (r^2 / (2 * sT * sN)) * exp(-0.5*(t_center^2/sT^2 + n_center^2/sN^2))
    const tCenter = 0.05; // km
    const nCenter = 0.03; // km
    const leadH = 2.0;

    const analyticalPc = pc(tCenter, nCenter, leadH);

    // Monte Carlo estimation with 200,000 samples
    const sT = 0.08 + 0.02 * leadH;
    const sN = 0.05 + 0.01 * leadH;
    const rHardBody = 0.0055; // 5.5m in km
    const r2 = rHardBody * rHardBody;

    let hits = 0;
    const N = 200000;
    // Box-Muller transform for Gaussian draws
    for (let i = 0; i < N; i++) {
      const u1 = Math.random() || 1e-7;
      const u2 = Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);

      const tSample = z0 * sT;
      const nSample = z1 * sN;

      const dist2 = (tSample - tCenter) * (tSample - tCenter) + (nSample - nCenter) * (nSample - nCenter);
      if (dist2 <= r2) {
        hits++;
      }
    }

    const mcPc = hits / N;

    // Both should be in the same probability order of magnitude and within reasonable statistical tolerance
    expect(analyticalPc).toBeGreaterThan(0);
    if (hits > 10) {
      const relError = Math.abs(analyticalPc - mcPc) / analyticalPc;
      expect(relError).toBeLessThan(0.35); // Within statistical variance for N=200k
    }
  });

  it('clamps output within valid [0, 1] probability range', () => {
    expect(pc(0, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(pc(0, 0, 0)).toBeLessThanOrEqual(1);
    expect(pc(100, 100, 10)).toBeGreaterThanOrEqual(0);
  });
});
