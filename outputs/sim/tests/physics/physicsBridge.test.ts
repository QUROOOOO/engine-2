import { describe, it, expect, afterEach } from 'vitest';
import { PhysicsBridge } from '../../src/workers/PhysicsBridge';
import { makeBody } from '../../src/physics/sgp4';
import { SATS, DEBRIS } from '../../src/tle-data';

describe('Physics Worker Bridge & Fallback Execution', () => {
  let bridge: PhysicsBridge;

  afterEach(() => {
    bridge?.terminate();
  });

  it('initializes and executes findApproach asynchronously', async () => {
    bridge = new PhysicsBridge();
    const sat = makeBody(SATS[0], 'sat');
    const deb = makeBody(DEBRIS[0], 'deb');
    const t0 = 1700000000000;

    const enc = await bridge.findApproach(sat, deb, t0, 4);
    expect(enc).not.toBeNull();
    expect(enc.miss).toBeGreaterThan(0);
    expect(enc.tca).toBeGreaterThanOrEqual(t0);
  });

  it('executes deriveEncounter asynchronously', async () => {
    bridge = new PhysicsBridge();
    const sat = makeBody(SATS[0], 'sat');
    const deb = makeBody(DEBRIS[1], 'deb');
    const t0 = 1700000000000;

    const enc = await bridge.deriveEncounter(sat, deb, t0, 0.2, 0.09);
    expect(enc).not.toBeNull();
    expect(enc.derived).toBe(true);
    expect(enc.miss).toBeCloseTo(0.09, 2);
  });
});
