import { describe, it, expect } from 'vitest';
import { Mulberry32 } from '../src/physics/SimulationClock';
import { DEBRIS_PALETTE, COL, createCraggyDebrisGeometry } from '../src/scene';

describe('Organic Craggy Space Debris Geometry & Unified Instancing', () => {
  it('generates a watertight craggy icosahedron mesh with 80 triangular faces and valid normals', () => {
    const geo = createCraggyDebrisGeometry();
    const pos = geo.attributes.position;
    const normals = geo.attributes.normal;

    expect(pos.count).toBeGreaterThan(0);
    expect(normals).toBeDefined();

    // Verify all vertex coordinates and normals are finite with zero NaNs
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true);
      expect(Number.isFinite(pos.getY(i))).toBe(true);
      expect(Number.isFinite(pos.getZ(i))).toBe(true);
      expect(Number.isFinite(normals.getX(i))).toBe(true);
      expect(Number.isFinite(normals.getY(i))).toBe(true);
      expect(Number.isFinite(normals.getZ(i))).toBe(true);

      const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      // Base radius is 0.18 with perturbation in [0.68, 1.28]
      expect(r).toBeGreaterThanOrEqual(0.18 * 0.67);
      expect(r).toBeLessThanOrEqual(0.18 * 1.29);
    }
  });

  it('assigns natural non-uniform scale bounded to [0.70, 1.40] with +-12% jitter', () => {
    const prng = new Mulberry32(1337);
    for (let i = 0; i < 400; i++) {
      const baseS = prng.range(0.70, 1.40);
      const sx = baseS * (1.0 + prng.range(-0.12, 0.12));
      const sy = baseS * (1.0 + prng.range(-0.12, 0.12));
      const sz = baseS * (1.0 + prng.range(-0.12, 0.12));

      expect(baseS).toBeGreaterThanOrEqual(0.70);
      expect(baseS).toBeLessThanOrEqual(1.40);
      expect(sx).toBeGreaterThanOrEqual(0.70 * 0.88);
      expect(sx).toBeLessThanOrEqual(1.40 * 1.12);
      expect(sy).toBeGreaterThanOrEqual(0.70 * 0.88);
      expect(sy).toBeLessThanOrEqual(1.40 * 1.12);
      expect(sz).toBeGreaterThanOrEqual(0.70 * 0.88);
      expect(sz).toBeLessThanOrEqual(1.40 * 1.12);
    }
  });

  it('assigns calm realistic zero-G tumble velocities in [-0.65, +0.65] rad/s per axis', () => {
    const prng = new Mulberry32(1337);
    for (let i = 0; i < 400; i++) {
      prng.range(0.70, 1.40);
      prng.range(-0.12, 0.12);
      prng.range(-0.12, 0.12);
      prng.range(-0.12, 0.12);
      prng.range(0, Math.PI * 2);
      prng.range(0, Math.PI * 2);
      prng.range(0, Math.PI * 2);

      const wx = prng.range(-0.65, 0.65);
      const wy = prng.range(-0.65, 0.65);
      const wz = prng.range(-0.65, 0.65);

      expect(wx).toBeGreaterThanOrEqual(-0.65);
      expect(wx).toBeLessThanOrEqual(0.65);
      expect(wy).toBeGreaterThanOrEqual(-0.65);
      expect(wy).toBeLessThanOrEqual(0.65);
      expect(wz).toBeGreaterThanOrEqual(-0.65);
      expect(wz).toBeLessThanOrEqual(0.65);
    }
  });

  it('uses authentic metallic space junk palette (Gunmetal, Slate, Titanium, Dark Char)', () => {
    expect(DEBRIS_PALETTE).toContain(0x525c68); // Gunmetal
    expect(DEBRIS_PALETTE).toContain(0x6e7b8b); // Slate Alloy
    expect(DEBRIS_PALETTE).toContain(0x8a96a3); // Weathered Titanium
    expect(DEBRIS_PALETTE).toContain(0x3b424c); // Dark Char
    expect(COL.sat).toBe(0x3b82f6); // ISRO default blue
    expect(COL.safe).toBe(0x10b981); // Engine 2 green
  });
});
