import { describe, it, expect } from 'vitest';
import { MU, R_EARTH, SAFE_MISS_KM, norm, sub, add, dot, cross } from '../src/physics';
import { ConfigManager } from '../src/config/ConfigManager';
import { asKm, asEpochMs } from '../src/types/units';

describe('Sanity & Configuration Smoke Test', () => {
  it('correctly exports orbital constants', () => {
    expect(MU).toBeCloseTo(398600.4418, 4);
    expect(R_EARTH).toBe(6371.0);
    expect(SAFE_MISS_KM).toBe(5.0);
  });

  it('performs vector algebra accurately', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    expect(add(a, b)).toEqual([5, 7, 9]);
    expect(sub(b, a)).toEqual([3, 3, 3]);
    expect(dot(a, b)).toBe(1 * 4 + 2 * 5 + 3 * 6);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(norm([3, 4, 0])).toBe(5);
  });

  it('initializes and provides validated config singleton', () => {
    const config = ConfigManager.getInstance().get();
    expect(config.simulation.safeMissKm).toBe(5.0);
    expect(config.simulation.maxDebris).toBe(400);
    expect(config.camera.fov).toBe(42);
  });

  it('handles branded unit casts', () => {
    const km = asKm(500);
    const ms = asEpochMs(1700000000000);
    expect(km).toBe(500);
    expect(ms).toBe(1700000000000);
  });
});
