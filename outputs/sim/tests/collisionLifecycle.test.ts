import { describe, it, expect } from 'vitest';
import {
  checkCollision,
  computeVelocityUnitVector,
  computeAvoidanceUnitVector,
  isAvoidanceArrowVisible,
  advanceLifecycle,
  COLLISION_RADIUS_KM,
} from '../src/physics/collision';
import { norm, dot } from '../src/physics/math';

describe('Collision Physics & Proximity Detection', () => {
  it('correctly detects separation beyond collision threshold', () => {
    const satPos = [7000, 0, 0];
    const debPos = [7000.15, 0, 0]; // 150m = 0.15 km > 0.08 km
    const result = checkCollision(satPos, debPos, COLLISION_RADIUS_KM);
    expect(result.colliding).toBe(false);
    expect(result.distanceKm).toBeCloseTo(0.15, 4);
  });

  it('triggers collision when separation <= 0.08 km (80 meters)', () => {
    const satPos = [7000.0, 500.0, -100.0];
    const debPos = [7000.03, 500.04, -100.0]; // separation ~ 0.05 km < 0.08 km
    const result = checkCollision(satPos, debPos, COLLISION_RADIUS_KM);
    expect(result.colliding).toBe(true);
    expect(result.distanceKm).toBeLessThanOrEqual(COLLISION_RADIUS_KM);
    // Centroid check
    expect(result.impactPosKm[0]).toBeCloseTo(7000.015, 4);
    expect(result.impactPosKm[1]).toBeCloseTo(500.02, 4);
    expect(result.impactPosKm[2]).toBeCloseTo(-100.0, 4);
  });

  it('detects direct head-on zero-miss impact', () => {
    const pos = [6800.0, 1200.0, 300.0];
    const result = checkCollision(pos, pos);
    expect(result.colliding).toBe(true);
    expect(result.distanceKm).toBe(0);
    expect(result.impactPosKm).toEqual(pos);
  });
});

describe('Dual Velocity & Avoidance Vector Mathematics', () => {
  it('computes unit velocity vector with length 1.0', () => {
    const v = [0, 6.0, 8.0]; // norm = 10
    const u = computeVelocityUnitVector(v);
    expect(norm(u)).toBeCloseTo(1.0, 6);
    expect(u[0]).toBeCloseTo(0, 6);
    expect(u[1]).toBeCloseTo(0.6, 6);
    expect(u[2]).toBeCloseTo(0.8, 6);
  });

  it('handles zero velocity vector gracefully', () => {
    const u = computeVelocityUnitVector([0, 0, 0]);
    expect(norm(u)).toBe(1.0);
    expect(u).toEqual([0, 1, 0]);
  });

  it('computes deflected avoidance vector with unit length and distinct angular separation', () => {
    const vOrig = [0, 7.5, 0]; // 7.5 km/s along Y
    const dvVec = [0, 0, 1.8]; // Cross-track impulse in Z
    const uAvoid = computeAvoidanceUnitVector(vOrig, dvVec, 0.25);

    // 1. Must be exact unit length
    expect(norm(uAvoid)).toBeCloseTo(1.0, 6);

    // 2. Must exhibit distinct non-zero angular separation from original path
    const uOrig = computeVelocityUnitVector(vOrig);
    const cosAngle = dot(uOrig, uAvoid);
    const angleRad = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    const angleDeg = (angleRad * 180) / Math.PI;

    expect(angleDeg).toBeGreaterThan(5.0);
    expect(angleDeg).toBeLessThan(35.0);
    expect(uAvoid[2]).toBeGreaterThan(0); // Deflection along Z
  });

  it('returns original vector when delta-V is zero', () => {
    const vOrig = [1.2, 5.4, -3.1];
    const uOrig = computeVelocityUnitVector(vOrig);
    const uAvoid = computeAvoidanceUnitVector(vOrig, [0, 0, 0]);
    expect(uAvoid[0]).toBeCloseTo(uOrig[0], 5);
    expect(uAvoid[1]).toBeCloseTo(uOrig[1], 5);
    expect(uAvoid[2]).toBeCloseTo(uOrig[2], 5);
  });
});

describe('Smart Visibility Rule for Avoidance Vector Arrow', () => {
  it('is visible ONLY when active encounter, feasible plan, camera focused on satellite, and satellite active', () => {
    const visible = isAvoidanceArrowVisible({
      isEncounterActive: true,
      hasPlan: true,
      isCameraFocusedOnSat: true,
      satLifecycle: 'ACTIVE',
    });
    expect(visible).toBe(true);
  });

  it('is HIDDEN in PLANET_CENTRIC view (camera not inspecting satellite)', () => {
    const visible = isAvoidanceArrowVisible({
      isEncounterActive: true,
      hasPlan: true,
      isCameraFocusedOnSat: false, // In Planet View
      satLifecycle: 'ACTIVE',
    });
    expect(visible).toBe(false);
  });

  it('is HIDDEN when encounter is nominal or cleared', () => {
    const visible = isAvoidanceArrowVisible({
      isEncounterActive: false, // Nominal state
      hasPlan: true,
      isCameraFocusedOnSat: true,
      satLifecycle: 'ACTIVE',
    });
    expect(visible).toBe(false);
  });

  it('is HIDDEN if no feasible plan exists', () => {
    const visible = isAvoidanceArrowVisible({
      isEncounterActive: true,
      hasPlan: false,
      isCameraFocusedOnSat: true,
      satLifecycle: 'ACTIVE',
    });
    expect(visible).toBe(false);
  });

  it('is HIDDEN if satellite is destroyed or removed', () => {
    const visible = isAvoidanceArrowVisible({
      isEncounterActive: true,
      hasPlan: true,
      isCameraFocusedOnSat: true,
      satLifecycle: 'REMOVED',
    });
    expect(visible).toBe(false);
  });
});

describe('Object Lifecycle State Machine Transitions', () => {
  it('preserves ACTIVE state during nominal operation', () => {
    const { nextState, progress } = advanceLifecycle('ACTIVE', 0);
    expect(nextState).toBe('ACTIVE');
    expect(progress).toBe(0);
  });

  it('advances through DISSOLVING phase as elapsed time increases', () => {
    const { nextState, progress } = advanceLifecycle('COLLIDING', 0.6, 1.2);
    expect(nextState).toBe('DISSOLVING');
    expect(progress).toBeCloseTo(0.5, 4);
  });

  it('transitions to REMOVED when dissolution duration completes (>= 1.2s)', () => {
    const { nextState, progress } = advanceLifecycle('DISSOLVING', 1.2, 1.2);
    expect(nextState).toBe('REMOVED');
    expect(progress).toBe(1.0);
  });

  it('clamps progress at 1.0 for times exceeding dissolution duration', () => {
    const { nextState, progress } = advanceLifecycle('DISSOLVING', 2.5, 1.2);
    expect(nextState).toBe('REMOVED');
    expect(progress).toBe(1.0);
  });
});
