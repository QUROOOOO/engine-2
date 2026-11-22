import { describe, it, expect } from 'vitest';
import { planManeuver, AXES } from '../../src/physics/maneuver';
import { makeBody } from '../../src/physics/sgp4';
import { deriveEncounter } from '../../src/physics/deriveEncounter';
import { SATS, DEBRIS } from '../../src/tle-data';
import { SAFE_MISS_KM, PC_WARN } from '../../src/physics/constants';

describe('Collision Avoidance Maneuver (CAM) Planning', () => {
  it('defines valid along-track, cross-track, and radial gain functions', () => {
    const n = 0.001; // rad/s
    const lead = 3600; // 1 hour

    const at = AXES.find(a => a.key === 'ALONG-TRACK')!;
    const ct = AXES.find(a => a.key === 'CROSS-TRACK')!;
    const rd = AXES.find(a => a.key === 'RADIAL')!;

    expect(at.gain(n, lead)).toBeGreaterThan(0);
    expect(ct.gain(n, lead)).toBeGreaterThanOrEqual(0);
    expect(rd.gain(n, lead)).toBeGreaterThanOrEqual(0);
  });

  it('generates a feasible plan when adequate fuel is available', () => {
    const sat = makeBody(SATS[0], 'sat');
    const deb = makeBody(DEBRIS[1], 'deb');
    const t0 = 1700000000000;

    // Create an imminent close encounter with 0.1 km miss distance
    const enc = deriveEncounter(sat, deb, t0, 0.5, 0.1);
    expect(enc).not.toBeNull();

    const plan = planManeuver(sat, deb, enc!, t0, 15.0); // 15 m/s available
    expect(plan).not.toBeNull();
    expect(plan!.safe).toBe(true);
    expect(plan!.dv).toBeLessThanOrEqual(15.0);
    expect(plan!.postMiss).toBeGreaterThanOrEqual(SAFE_MISS_KM as number);
    expect(plan!.postPc).toBeLessThan(PC_WARN as number);
    expect(plan!.note).toBe('NOMINAL');
  });

  it('flags unsafe and exhausts budget when available fuel is severely constrained', () => {
    const sat = makeBody(SATS[0], 'sat');
    const deb = makeBody(DEBRIS[1], 'deb');
    const t0 = 1700000000000;

    const enc = deriveEncounter(sat, deb, t0, 0.5, 0.05);
    expect(enc).not.toBeNull();

    // Severely restricted fuel: only 0.01 m/s available
    const plan = planManeuver(sat, deb, enc!, t0, 0.01);
    expect(plan).not.toBeNull();
    expect(plan!.safe).toBe(false);
    expect(plan!.burned).toBe(true);
    expect(plan!.note).toContain('EXHAUSTED');
  });

  it('returns null or handles past TCA gracefully', () => {
    const sat = makeBody(SATS[0], 'sat');
    const deb = makeBody(DEBRIS[1], 'deb');
    const t0 = 1700000000000;

    // Encounter in the past relative to nowMs
    const plan = planManeuver(sat, deb, { tca: t0 - 100000, miss: 0.1 }, t0, 15.0);
    expect(plan).toBeNull();
  });
});
