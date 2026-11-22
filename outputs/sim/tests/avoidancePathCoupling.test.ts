import { describe, it, expect } from 'vitest';
import { sampleAvoidanceTrajectory } from '../src/physics/maneuver';
import { isAvoidanceArrowVisible } from '../src/physics/collision';
import { makeBody } from '../src/physics/sgp4';
import { SATS } from '../src/tle-data';
import { dot, norm } from '../src/physics/math';

describe('Avoidance Trajectory Mathematical Coupling & Directional Alignment', () => {
  const satBody = makeBody(SATS[0], 'sat');

  const t0 = 1710936000000;
  const burnMs = t0 + 10000;
  const tcaMs = t0 + 40000;

  const burnPlan = {
    r0: [6800, 0, 0] as [number, number, number],
    v0: [0, 7.6, 0.05] as [number, number, number],
    burnMs,
  };

  const bundle = sampleAvoidanceTrajectory(satBody, burnPlan, tcaMs, 18.0, 96);

  it('guarantees seamless C^1 continuity at burn point (distance < 1e-6)', () => {
    const pAvoid0 = bundle.avoidPoints[0];
    const pDef0 = bundle.defaultPoints[0];

    const dist = Math.hypot(
      pAvoid0[0] - pDef0[0],
      pAvoid0[1] - pDef0[1],
      pAvoid0[2] - pDef0[2]
    );

    expect(dist).toBeLessThan(1e-6);
  });

  it('guarantees satellite position at any t during dodge lies directly on the green curve', () => {
    // Check multiple epochs during dodge window
    for (const frac of [0.1, 0.35, 0.5, 0.75, 0.9]) {
      const t = burnMs + (tcaMs - burnMs) * frac;
      const evalRes = bundle.evaluateAt(t);

      expect(evalRes.inDodgeWindow).toBe(true);

      // Find minimum distance from evalRes.pos to the sampled green curve
      let minCurveDist = Infinity;
      for (const pt of bundle.avoidPoints) {
        const d = Math.hypot(
          evalRes.pos[0] - pt[0],
          evalRes.pos[1] - pt[1],
          evalRes.pos[2] - pt[2]
        );
        if (d < minCurveDist) minCurveDist = d;
      }

      // 96 sample points along curve ensure maximum distance between adjacent samples is small
      expect(minCurveDist).toBeLessThan(0.08); // within segment chord tolerance
    }
  });

  it('aligns green avoidance arrow to the exact tangent of the green avoidance curve (dot > 0.999)', () => {
    const t = burnMs + (tcaMs - burnMs) * 0.5;
    const evalRes = bundle.evaluateAt(t);

    // Analytical forward tangent from small central difference
    const dt = 100;
    const pPrev = bundle.evaluateAt(t - dt).pos;
    const pNext = bundle.evaluateAt(t + dt).pos;
    const dTangent = [
      pNext[0] - pPrev[0],
      pNext[1] - pPrev[1],
      pNext[2] - pPrev[2],
    ];
    const dTanNorm = norm(dTangent);
    const uTangent = [dTangent[0] / dTanNorm, dTangent[1] / dTanNorm, dTangent[2] / dTanNorm];

    const cosAngle = dot(evalRes.avoidDir, uTangent);
    expect(cosAngle).toBeGreaterThan(0.999);
  });

  it('gates avoidance path & arrow visibility strictly by active encounter and OBJECT_CENTRIC focus', () => {
    // Hidden in PLANET_CENTRIC view even when encounter is active
    expect(
      isAvoidanceArrowVisible({
        isEncounterActive: true,
        hasPlan: true,
        isCameraFocusedOnSat: false,
        satLifecycle: 'ACTIVE',
      })
    ).toBe(false);

    // Visible only when focused in OBJECT_CENTRIC on the dodging satellite
    expect(
      isAvoidanceArrowVisible({
        isEncounterActive: true,
        hasPlan: true,
        isCameraFocusedOnSat: true,
        satLifecycle: 'ACTIVE',
      })
    ).toBe(true);

    // Hidden when encounter is resolved
    expect(
      isAvoidanceArrowVisible({
        isEncounterActive: false,
        hasPlan: true,
        isCameraFocusedOnSat: true,
        satLifecycle: 'ACTIVE',
      })
    ).toBe(false);
  });
});
