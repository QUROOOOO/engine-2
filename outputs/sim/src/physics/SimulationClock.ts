/**
 * SimulationClock: Fixed-timestep accumulator clock with seedable Mulberry32 PRNG.
 * Ensures deterministic bit-identical simulation replay for regression testing.
 */

export class Mulberry32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

export interface ClockOptions {
  fixedDtSec?: number; // default: 1/60 s
  seed?: number;
  initialEpochMs?: number;
  rate?: number;
}

export class SimulationClock {
  public fixedDtMs: number;
  public simEpochMs: number;
  public rate: number;
  public paused: boolean;
  public prng: Mulberry32;

  private accumulatorMs: number = 0;
  private t0Ms: number;
  private tickCount: number = 0;

  constructor(options: ClockOptions = {}) {
    const dt = options.fixedDtSec ?? 1 / 60;
    this.fixedDtMs = dt * 1000;
    this.t0Ms = options.initialEpochMs ?? Date.now();
    this.simEpochMs = this.t0Ms;
    this.rate = options.rate ?? 60;
    this.paused = false;
    this.prng = new Mulberry32(options.seed ?? 42);
  }

  public play(): void {
    this.paused = false;
  }

  public pause(): void {
    this.paused = true;
  }

  public toggle(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  public setRate(rate: number): void {
    this.rate = Math.max(0.1, rate);
  }

  public reset(epochMs?: number): void {
    this.simEpochMs = epochMs ?? this.t0Ms;
    this.accumulatorMs = 0;
    this.tickCount = 0;
  }

  public scrub(fraction: number, windowDurationMs: number): void {
    this.simEpochMs = this.t0Ms + windowDurationMs * Math.min(1, Math.max(0, fraction));
    this.accumulatorMs = 0;
  }

  /**
   * Advances real elapsed time and returns the number of fixed simulation ticks to execute.
   *
   * @param realDeltaMs Real wall-clock elapsed time in milliseconds
   * @returns Number of fixed ticks to simulate this frame
   */
  public advance(realDeltaMs: number): number {
    if (this.paused) return 0;

    // Scale real delta by simulation speed rate
    const scaledDeltaMs = realDeltaMs * this.rate;
    this.accumulatorMs += scaledDeltaMs;

    // Safety clamp to prevent unbounded backlog on tab switching (allow up to 5s real time backlog)
    const maxAccumulator = Math.max(this.fixedDtMs * 120, 5000 * this.rate);
    if (this.accumulatorMs > maxAccumulator) {
      this.accumulatorMs = maxAccumulator;
    }

    let ticks = 0;
    while (this.accumulatorMs >= this.fixedDtMs - 1e-5) {
      this.simEpochMs += this.fixedDtMs;
      this.accumulatorMs -= this.fixedDtMs;
      if (this.accumulatorMs < 0) this.accumulatorMs = 0;
      this.tickCount++;
      ticks++;
    }

    return ticks;
  }

  /**
   * Forces a single deterministic step forward by fixedDtMs.
   */
  public stepFixed(): void {
    this.simEpochMs += this.fixedDtMs;
    this.tickCount++;
  }

  public getTicks(): number {
    return this.tickCount;
  }

  public getMissionElapsedSeconds(): number {
    return (this.simEpochMs - this.t0Ms) / 1000;
  }
}
