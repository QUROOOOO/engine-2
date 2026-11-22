import { describe, it, expect } from 'vitest';
import { SimulationClock, Mulberry32 } from '../../src/physics/SimulationClock';

describe('Deterministic Simulation Clock & PRNG', () => {
  it('produces bit-identical pseudo-random sequences given the same seed', () => {
    const rng1 = new Mulberry32(1337);
    const rng2 = new Mulberry32(1337);

    const seq1 = Array.from({ length: 50 }, () => rng1.next());
    const seq2 = Array.from({ length: 50 }, () => rng2.next());

    expect(seq1).toEqual(seq2);
    expect(seq1[0]).toBeGreaterThanOrEqual(0);
    expect(seq1[0]).toBeLessThanOrEqual(1);
  });

  it('accumulates real time into exact discrete fixed-timestep ticks', () => {
    const clock = new SimulationClock({ fixedDtSec: 1 / 60, rate: 1 });
    const initialEpoch = clock.simEpochMs;

    // Advance 50ms of real time at 1x rate
    // 50ms / 16.6666ms = 3 ticks executed (49.999ms), with ~0.001ms left in accumulator
    const ticks = clock.advance(50);
    expect(ticks).toBe(3);
    expect(clock.getTicks()).toBe(3);
    expect(Math.abs(clock.simEpochMs - (initialEpoch + 50))).toBeLessThan(1);
  });

  it('multiplies elapsed time by simulation rate factor', () => {
    const clock = new SimulationClock({ fixedDtSec: 1 / 60, rate: 60 });
    const initialEpoch = clock.simEpochMs;

    // 1000ms real time * 60 rate = 60,000ms sim time
    // 60,000ms / 16.6666ms = 3600 ticks
    const ticks = clock.advance(1000);
    expect(ticks).toBe(3600);
    expect(Math.abs(clock.simEpochMs - (initialEpoch + 60000))).toBeLessThan(2);
  });

  it('suspends time advancement when paused', () => {
    const clock = new SimulationClock();
    clock.pause();

    const initialEpoch = clock.simEpochMs;
    const ticks = clock.advance(500);

    expect(ticks).toBe(0);
    expect(clock.simEpochMs).toBe(initialEpoch);
  });
});
