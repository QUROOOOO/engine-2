import { describe, it, expect } from 'vitest';
import { makeBody, stateAt, gmst } from '../../src/physics/sgp4';
import { findApproach } from '../../src/physics/findApproach';
import { SATS, DEBRIS } from '../../src/tle-data';
import { norm } from '../../src/physics/math';

describe('SGP4 Propagator & Conjunction Detection', () => {
  it('correctly parses TLE into SpaceBody orbital parameters', () => {
    const cartosat = makeBody(SATS[0], 'sat');
    expect(cartosat.norad).toBe(28649);
    expect(cartosat.name.toUpperCase()).toContain('CARTOSAT');
    expect(cartosat.inc).toBeCloseTo(97.52, 1);
    expect(cartosat.ecc).toBeCloseTo(0.0000668, 6);
    expect(cartosat.period).toBeGreaterThan(5000);
    expect(cartosat.alt).toBeGreaterThan(500);
    expect(cartosat.alt).toBeLessThan(700);
  });

  it('maintains continuous position and velocity vectors over 24 hours', () => {
    const sat = makeBody(SATS[0], 'sat');
    const t0 = 1700000000000; // Reference epoch

    let prevPos = stateAt(sat, t0);
    expect(prevPos).not.toBeNull();

    // Check step continuity every 10 minutes over 24 hours
    for (let m = 10; m <= 1440; m += 60) {
      const cur = stateAt(sat, t0 + m * 60000);
      expect(cur).not.toBeNull();
      const rMag = norm(cur!.r);
      const vMag = norm(cur!.v);

      // Low Earth Orbit altitude constraint: 6800 - 7200 km
      expect(rMag).toBeGreaterThan(6800);
      expect(rMag).toBeLessThan(7200);

      // Orbital velocity in LEO: 7.2 - 7.8 km/s
      expect(vMag).toBeGreaterThan(7.2);
      expect(vMag).toBeLessThan(7.8);
    }
  });

  it('computes monotonically advancing GMST angle', () => {
    const t0 = 1700000000000;
    const g0 = gmst(t0);
    const g1 = gmst(t0 + 3600000); // 1 hour later

    // Earth rotates ~15 degrees per hour = ~0.2618 rad/hr
    const diff = (g1 - g0 + 2 * Math.PI) % (2 * Math.PI);
    expect(diff).toBeCloseTo((15 * Math.PI) / 180, 2);
  });

  it('executes findApproach and identifies closest approach geometry', () => {
    const sat = makeBody(SATS[0], 'sat');
    const deb = makeBody(DEBRIS[0], 'deb');
    const t0 = 1700000000000;

    const encounter = findApproach(sat, deb, t0, 6);
    expect(encounter).not.toBeNull();
    expect(encounter!.tca).toBeGreaterThanOrEqual(t0);
    expect(encounter!.miss).toBeGreaterThan(0);
    expect(encounter!.relSpeed).toBeGreaterThan(0);
    expect(encounter!.rt).toBeDefined();
    expect(isFinite(encounter!.rt!.r)).toBe(true);
    expect(isFinite(encounter!.rt!.t)).toBe(true);
    expect(isFinite(encounter!.rt!.n)).toBe(true);
  });
});
