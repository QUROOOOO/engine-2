import { describe, it, expect } from 'vitest';
import {
  fmt,
  fmtMiss,
  fmtRelSpeed,
  fmtDv,
  fmtFuel,
  fmtPc,
  fmtPcCompact,
  fmtAge,
  fmtMet,
  fmtTimeToTca,
  fmtLeadTime,
} from '../../src/ui/formatters';
import { classifyRisk, formatRiskLabel } from '../../src/ui/riskClassifier';
import { filterObjects, type CatalogRowItem } from '../../src/ui/filters';
import {
  computeBPlaneConfig,
  projectBPlanePoint,
  computeBPlaneEllipses,
} from '../../src/ui/bplaneMath';

describe('UI Logic — Formatters', () => {
  it('formats general numbers with fallback for non-finite values', () => {
    expect(fmt(12.3456, 2)).toBe('12.35');
    expect(fmt(0, 1)).toBe('0.0');
    expect(fmt(undefined)).toBe('—');
    expect(fmt(null)).toBe('—');
    expect(fmt(NaN)).toBe('—');
    expect(fmt(Infinity)).toBe('—');
  });

  it('formats miss distance, velocity, delta-v, and fuel', () => {
    expect(fmtMiss(0.1234)).toBe('0.123 km');
    expect(fmtMiss(null)).toBe('—');

    expect(fmtRelSpeed(14.856)).toBe('14.86 km/s');
    expect(fmtRelSpeed(undefined)).toBe('—');

    expect(fmtDv(4.567)).toBe('4.57 m/s');
    expect(fmtDv(null)).toBe('—');

    expect(fmtFuel(12.5)).toBe('12.50 m/s');
    expect(fmtFuel(-2.0)).toBe('0.00 m/s'); // Non-negative fuel display
    expect(fmtFuel(NaN)).toBe('—');
  });

  it('formats collision probabilities with scientific and compact notation', () => {
    expect(fmtPc(0.000456)).toBe('4.56e−4');
    expect(fmtPc(0.05)).toBe('0.0500');
    expect(fmtPc(1e-15)).toBe('<1e-12');
    expect(fmtPc(0)).toBe('<1e-12');
    expect(fmtPc(NaN)).toBe('—');

    expect(fmtPcCompact(0.000456)).toBe('4.6e−4');
    expect(fmtPcCompact(1e-14)).toBe('<1e-12');
    expect(fmtPcCompact(null)).toBe('—');
  });

  it('formats epoch age and mission elapsed time (MET)', () => {
    expect(fmtAge(8.423)).toBe('8.4');
    expect(fmtAge(null)).toBe('—');

    expect(fmtMet(0)).toBe('00:00:00');
    expect(fmtMet(65000)).toBe('00:01:05');
    expect(fmtMet(3665000)).toBe('01:01:05');
  });

  it('formats time to TCA and burn lead time', () => {
    expect(fmtTimeToTca(12.5)).toBe('T−12.5 min');
    expect(fmtTimeToTca(90)).toBe('T−1.50 h');
    expect(fmtTimeToTca(-1)).toBe('PASSED');

    expect(fmtLeadTime(120)).toBe('2.00 h');
    expect(fmtLeadTime(-5)).toBe('—');
  });
});

describe('UI Logic — Risk Classifier', () => {
  it('correctly classifies risk based on miss distance and collision probability', () => {
    // Critical: miss < 1.0 km or Pc >= 1e-3
    expect(classifyRisk(0.8, 1e-5)).toBe('crit');
    expect(classifyRisk(3.0, 2e-3)).toBe('crit');

    // Warning: miss < 5.0 km or Pc >= 1e-4
    expect(classifyRisk(2.5, 1e-5)).toBe('warn');
    expect(classifyRisk(8.0, 5e-4)).toBe('warn');

    // Safe: miss >= 5.0 km and Pc < 1e-4
    expect(classifyRisk(5.2, 1e-6)).toBe('safe');
    expect(classifyRisk(10.0, 0)).toBe('safe');

    // Guard non-finite
    expect(classifyRisk(NaN, NaN)).toBe('safe');
  });

  it('provides readable human labels for risk chips', () => {
    expect(formatRiskLabel('crit')).toBe('CRITICAL');
    expect(formatRiskLabel('warn')).toBe('WARNING');
    expect(formatRiskLabel('safe')).toBe('NOMINAL');
  });
});

describe('UI Logic — Catalog Filters', () => {
  const sampleItems: CatalogRowItem[] = [
    { kind: 'sat', index: 0, name: 'CARTOSAT-1', norad: 28649, risk: 'safe' },
    { kind: 'sat', index: 1, name: 'CARTOSAT-2A', norad: 32783, risk: 'safe' },
    { kind: 'deb', index: 0, name: 'COSMOS 2251 DEB #1', norad: 33757, risk: 'safe' },
    { kind: 'deb', index: 1, name: 'COSMOS 2251 DEB #2', norad: 33758, risk: 'crit' },
    { kind: 'deb', index: 2, name: 'FENGYUN 1C DEB #1', norad: 29733, risk: 'warn' },
    { kind: 'deb', index: 3, name: 'FENGYUN 1C DEB #2', norad: 29734, risk: 'safe' },
  ];

  it('filters by active satellite count and debris count', () => {
    const res = filterObjects(sampleItems, '', 1, 2);
    // satN=1 -> only sat index 0
    // debN=2 -> deb indices 0, 1
    expect(res.map(r => `${r.kind}:${r.index}`)).toEqual(['sat:0', 'deb:0', 'deb:1']);
  });

  it('pins the active threat debris even if its index exceeds active debN', () => {
    // debN=1 would normally exclude deb:2, but threatIndex=2 pins it
    const res = filterObjects(sampleItems, '', 1, 1, 2);
    const keys = res.map(r => `${r.kind}:${r.index}`);
    expect(keys).toContain('sat:0');
    expect(keys).toContain('deb:0');
    expect(keys).toContain('deb:2'); // pinned threat
    expect(keys).not.toContain('deb:1');
  });

  it('ranks active threat debris directly below satellites', () => {
    const res = filterObjects(sampleItems, '', 2, 4, 1);
    // Expected order: satellites first (0, 1), then threat (deb:1), then other debris (0, 2, 3)
    expect(res[0].kind).toBe('sat');
    expect(res[1].kind).toBe('sat');
    expect(res[2]).toEqual(expect.objectContaining({ kind: 'deb', index: 1 }));
  });

  it('filters objects case-insensitively by name substring', () => {
    const res = filterObjects(sampleItems, 'fengyun');
    expect(res.length).toBe(2);
    expect(res.every(r => r.name.includes('FENGYUN'))).toBe(true);
  });

  it('filters objects by NORAD ID string', () => {
    const res = filterObjects(sampleItems, '28649');
    expect(res.length).toBe(1);
    expect(res[0].name).toBe('CARTOSAT-1');
  });
});

describe('UI Logic — B-Plane Geometry Math', () => {
  const cfg = computeBPlaneConfig(300, 6);

  it('computes grid geometry center and scale factor', () => {
    expect(cfg.size).toBe(300);
    expect(cfg.kmRange).toBe(6);
    expect(cfg.center).toBe(150);
    // (150 - 18) / 6 = 132 / 6 = 22 px/km
    expect(cfg.scale).toBeCloseTo(22, 4);
  });

  it('projects (T, N) coordinates to canvas pixels correctly', () => {
    // (0, 0) maps to canvas center (150, 150)
    const centerPt = projectBPlanePoint(0, 0, cfg);
    expect(centerPt.x).toBe(150);
    expect(centerPt.y).toBe(150);
    expect(centerPt.clamped).toBe(false);

    // (+1 km T, +2 km N):
    // X = 150 + 1 * 22 = 172
    // Y = 150 - 2 * 22 = 106
    const offsetPt = projectBPlanePoint(1, 2, cfg);
    expect(offsetPt.x).toBeCloseTo(172, 1);
    expect(offsetPt.y).toBeCloseTo(106, 1);
    expect(offsetPt.clamped).toBe(false);
  });

  it('clamps coordinates exceeding canvas boundary range', () => {
    const outPt = projectBPlanePoint(10, -15, cfg);
    expect(outPt.clamped).toBe(true);
    expect(outPt.x).toBeLessThanOrEqual(300);
    expect(outPt.y).toBeLessThanOrEqual(300);
    expect(outPt.x).toBeGreaterThanOrEqual(0);
    expect(outPt.y).toBeGreaterThanOrEqual(0);
  });

  it('calculates 1, 2, and 3 sigma covariance error ellipses', () => {
    const rt = { r: 0 as any, t: 1.5 as any, n: -1.0 as any };
    const ellipses = computeBPlaneEllipses(rt, cfg, 0.16, 0.1);

    expect(ellipses.length).toBe(3);

    // Center matches projected point
    expect(ellipses[0].cx).toBeCloseTo(150 + 1.5 * 22, 1);
    expect(ellipses[0].cy).toBeCloseTo(150 - -1.0 * 22, 1);

    // Multipliers scale linearly
    expect(ellipses[0].sigmaMultiplier).toBe(1);
    expect(ellipses[1].sigmaMultiplier).toBe(2);
    expect(ellipses[2].sigmaMultiplier).toBe(3);

    expect(ellipses[1].xRadius).toBeCloseTo(ellipses[0].xRadius * 2, 4);
    expect(ellipses[2].yRadius).toBeCloseTo(ellipses[0].yRadius * 3, 4);
  });

  it('returns empty array when rt is undefined', () => {
    expect(computeBPlaneEllipses(undefined, cfg)).toEqual([]);
  });
});
