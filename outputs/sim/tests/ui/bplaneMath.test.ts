import { describe, it, expect } from 'vitest';
import type { Km } from '../../src/types/units';
import {
  computeBPlaneConfig,
  projectBPlanePoint,
  computeBPlaneEllipses,
  buildBPlaneData,
} from '../../src/ui/bplaneMath';

describe('B-Plane Mathematical Transformations (buildBPlaneData)', () => {
  const config = computeBPlaneConfig(300, 6.0);

  it('computes grid geometry centering and scale', () => {
    expect(config.size).toBe(300);
    expect(config.center).toBe(150);
    expect(config.kmRange).toBe(6.0);
    // padding is 18px, so usable radius is 132px / 6km = 22 px/km
    expect(config.scale).toBe(22);
  });

  it('projects (T, N) coordinates to canvas pixel space', () => {
    // Origin (0, 0) maps to center (150, 150)
    const pOrigin = projectBPlanePoint(0, 0, config);
    expect(pOrigin.x).toBe(150);
    expect(pOrigin.y).toBe(150);
    expect(pOrigin.clamped).toBe(false);

    // (+1 km T, +2 km N) -> (+22px X, -44px Y)
    const pOffset = projectBPlanePoint(1.0, 2.0, config);
    expect(pOffset.x).toBe(172);
    expect(pOffset.y).toBe(106);
    expect(pOffset.clamped).toBe(false);
  });

  it('clamps coordinates exceeding canvas boundary range', () => {
    const pExtreme = projectBPlanePoint(100.0, -100.0, config);
    expect(pExtreme.clamped).toBe(true);
    expect(pExtreme.x).toBeLessThanOrEqual(300);
    expect(pExtreme.y).toBeGreaterThanOrEqual(0);
  });

  it('computes 1, 2, and 3 sigma covariance error ellipses', () => {
    const ellipses = computeBPlaneEllipses(
      { r: 0.1 as Km, t: 0.5 as Km, n: -0.2 as Km },
      config,
      0.16,
      0.1
    );
    expect(ellipses).toHaveLength(3);

    expect(ellipses[0].sigmaMultiplier).toBe(1);
    expect(ellipses[1].sigmaMultiplier).toBe(2);
    expect(ellipses[2].sigmaMultiplier).toBe(3);

    // 2-sigma radius is double 1-sigma radius
    expect(ellipses[1].xRadius).toBeCloseTo(ellipses[0].xRadius * 2, 5);
    expect(ellipses[1].yRadius).toBeCloseTo(ellipses[0].yRadius * 2, 5);
  });

  it('builds complete BPlaneData structure with boundary handling', () => {
    const data = buildBPlaneData(
      { r: 0 as Km, t: 1.5 as Km, n: -0.5 as Km },
      1.58,
      { sT: 0.2, sN: 0.15 }
    );
    expect(data.config.size).toBe(300);
    expect(data.missPoint.clamped).toBe(false);
    expect(data.ellipses).toHaveLength(3);
    expect(data.safeRadiusPx).toBe(5.0 * data.config.scale);

    // Handles undefined or 0 coordinates cleanly
    const nullData = buildBPlaneData(undefined, 0);
    expect(nullData.missPoint.x).toBe(150);
    expect(nullData.missPoint.y).toBe(150);
    expect(nullData.ellipses).toEqual([]);
  });
});
