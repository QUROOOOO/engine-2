import { describe, it, expect } from 'vitest';
import { deriveEncounter } from '../../src/physics/deriveEncounter';
import { makeBody, stateAt } from '../../src/physics/sgp4';
import { SATS, DEBRIS } from '../../src/tle-data';
import { norm, sub } from '../../src/physics/math';

describe('Synthetic Conjunction Encounter Synthesis', () => {
  it('guarantees encounter miss distance <= specified target distance', () => {
    const sat = makeBody(SATS[0], 'sat');
    const deb = makeBody(DEBRIS[2], 'deb');
    const t0 = 1700000000000;
    const targetMissKm = 0.08;

    const enc = deriveEncounter(sat, deb, t0, 0.25, targetMissKm);
    expect(enc).not.toBeNull();
    expect(enc!.derived).toBe(true);
    expect(enc!.miss).toBeLessThanOrEqual(targetMissKm * 1.05);
    expect(enc!.relSpeed).toBeGreaterThan(0);
    expect(enc!.tca).toBe(t0 + Math.round(0.25 * 3600000));
  });

  it('updates SpaceBody with valid physical parameters and persistent synthetic state', () => {
    const sat = makeBody(SATS[0], 'sat');
    const deb = makeBody(DEBRIS[3], 'deb');
    const t0 = 1700000000000;

    const enc = deriveEncounter(sat, deb, t0, 0.3, 0.15);
    expect(enc).not.toBeNull();
    expect(deb._synth).toBeDefined();

    // Verify derived orbital elements are physically realistic
    expect(deb.period).toBeGreaterThan(4500);
    expect(deb.period).toBeLessThan(8500);
    expect(deb.alt).toBeGreaterThan(300);
    expect(deb.alt).toBeLessThan(3000);
    expect(isFinite(deb.inc as number)).toBe(true);

    // Propagate deb at TCA and ensure position matches sat position + miss offset
    const satAtTca = stateAt(sat, enc!.tca as number);
    const debAtTca = stateAt(deb, enc!.tca as number);

    expect(satAtTca).not.toBeNull();
    expect(debAtTca).not.toBeNull();

    const actualMiss = norm(sub(debAtTca!.r, satAtTca!.r));
    expect(actualMiss).toBeCloseTo(0.15, 2);
  });
});
