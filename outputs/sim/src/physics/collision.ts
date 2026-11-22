import { norm, sub, add, scale, unit, dot } from './math';
import type { LifecycleState } from '../types/orbital';

/** Physical radius threshold for kinetic satellite-debris impact in km (80 meters) */
export const COLLISION_RADIUS_KM = 0.08;

/** Default dissolution animation duration in seconds following kinetic flash */
export const DISSOLVE_DURATION_SEC = 1.2;

/**
 * Computes the normalized unit velocity vector along an object's instantaneous trajectory.
 */
export function computeVelocityUnitVector(v: readonly number[]): [number, number, number] {
  const n = norm(v);
  if (n < 1e-9) return [0, 1, 0];
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * Computes the normalized unit avoidance vector following a thruster maneuver.
 * Adds a calibrated visual deflection factor so the angular separation between the
 * Blue Original Path and Green Avoidance Arrow is clearly perceptible during inspection.
 *
 * @param vOrig Instantaneous orbital velocity in km/s
 * @param dvVec Thruster delta-V vector in m/s (or km/s)
 * @param visualDeflectionFactor Angular separation multiplier for clear visual inspection
 */
export function computeAvoidanceUnitVector(
  vOrig: readonly number[],
  dvVec: readonly number[],
  visualDeflectionFactor = 0.24
): [number, number, number] {
  const uVel = computeVelocityUnitVector(vOrig);
  const dvNorm = norm(dvVec);
  if (dvNorm < 1e-6) return uVel;

  // Deflection direction from thruster vector
  const uDv = unit(dvVec);

  // Combine along-track/cross-track deflection with original velocity
  const vDeflected = add(uVel, scale(uDv, visualDeflectionFactor));
  return computeVelocityUnitVector(vDeflected);
}

/**
 * Checks physical distance between satellite and debris for physical collision.
 */
export function checkCollision(
  satPos: readonly number[],
  debPos: readonly number[],
  thresholdKm = COLLISION_RADIUS_KM
): { colliding: boolean; distanceKm: number; impactPosKm: [number, number, number] } {
  const rel = sub(satPos, debPos);
  const distanceKm = norm(rel);
  const colliding = distanceKm <= thresholdKm;
  const impactPosKm = scale(add(satPos, debPos), 0.5);

  return { colliding, distanceKm, impactPosKm };
}

/**
 * Swept continuous collision detection (CCD) between two moving bodies across a time step.
 * Computes the minimum distance between relative position trajectories from (t - dt) to t.
 * Completely eliminates bullet-tunneling at high orbital relative velocities (~11+ km/s).
 */
export function checkSweptCollision(
  satPrevPos: readonly number[],
  satCurrPos: readonly number[],
  debPrevPos: readonly number[],
  debCurrPos: readonly number[],
  thresholdKm = COLLISION_RADIUS_KM
): { colliding: boolean; minDistanceKm: number; impactPosKm: [number, number, number] } {
  const p0 = sub(satPrevPos, debPrevPos);
  const p1 = sub(satCurrPos, debCurrPos);
  const d = sub(p1, p0);
  const dLenSq = dot(d, d);

  let s = 0.5;
  if (dLenSq > 1e-12) {
    s = Math.max(0, Math.min(1, -dot(p0, d) / dLenSq));
  }

  const pClosest = add(p0, scale(d, s));
  const minDistanceKm = norm(pClosest);
  const colliding = minDistanceKm <= thresholdKm;

  const satImpact = add(satPrevPos, scale(sub(satCurrPos, satPrevPos), s));
  const debImpact = add(debPrevPos, scale(sub(debCurrPos, debPrevPos), s));
  const impactPosKm = scale(add(satImpact, debImpact), 0.5);

  return { colliding, minDistanceKm, impactPosKm };
}

export interface AvoidanceVisibilityParams {
  isEncounterActive: boolean;
  hasPlan: boolean;
  isCameraFocusedOnSat: boolean;
  satLifecycle?: LifecycleState;
}

/**
 * Smart Visibility Rule for the Green Avoidance Maneuver Arrow:
 * Visible ONLY when ALL 3 conditions hold simultaneously:
 * 1. An active conjunction event is in ALERT or DODGING phase (< 5.0 km).
 * 2. Engine 2 has computed a feasible avoidance burn.
 * 3. The camera is actively focusing on that specific endangered satellite in OBJECT_CENTRIC mode.
 * 4. The satellite is in ACTIVE lifecycle state.
 */
export function isAvoidanceArrowVisible(params: AvoidanceVisibilityParams): boolean {
  if (!params.isEncounterActive) return false;
  if (!params.hasPlan) return false;
  if (!params.isCameraFocusedOnSat) return false;
  if (params.satLifecycle && params.satLifecycle !== 'ACTIVE') return false;
  return true;
}

/**
 * Pure state machine transition helper for object lifecycle.
 * ACTIVE -> COLLIDING -> DISSOLVING -> REMOVED
 */
export function advanceLifecycle(
  currentState: LifecycleState,
  elapsedSec: number,
  dissolveDurationSec = DISSOLVE_DURATION_SEC
): { nextState: LifecycleState; progress: number } {
  if (currentState === 'ACTIVE') {
    return { nextState: 'ACTIVE', progress: 0 };
  }

  const progress = Math.min(1.0, Math.max(0, elapsedSec / dissolveDurationSec));

  if (progress >= 1.0) {
    return { nextState: 'REMOVED', progress: 1.0 };
  }

  return { nextState: 'DISSOLVING', progress };
}
