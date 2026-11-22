import { describe, it, expect } from 'vitest';
import { twoBody } from '../../src/physics/twoBody';
import { stumpffC, stumpffS } from '../../src/physics/stumpff';
import { MU } from '../../src/physics/constants';
import { norm, cross } from '../../src/physics/math';

describe('Universal Variable Two-Body Propagation', () => {
  it('conserves position after one full orbital period in circular LEO', () => {
    const rMag = 7000; // km
    const vMag = Math.sqrt(MU / rMag); // km/s ~ 7.546 km/s
    const period = 2 * Math.PI * Math.sqrt(Math.pow(rMag, 3) / MU); // ~5826 seconds

    const r0: [number, number, number] = [rMag, 0, 0];
    const v0: [number, number, number] = [0, vMag, 0];

    const propagated = twoBody(r0, v0, period);

    // After 1 period, position and velocity should return to initial state
    expect(propagated.r[0]).toBeCloseTo(r0[0], 1);
    expect(propagated.r[1]).toBeCloseTo(r0[1], 1);
    expect(propagated.r[2]).toBeCloseTo(r0[2], 1);
    expect(propagated.v[0]).toBeCloseTo(v0[0], 2);
    expect(propagated.v[1]).toBeCloseTo(v0[1], 2);
    expect(propagated.v[2]).toBeCloseTo(v0[2], 2);
  });

  it('strictly conserves specific orbital energy across an eccentric orbit', () => {
    const rp = 6600; // periapsis radius in km
    const ra = 12000; // apoapsis radius in km
    const a = (rp + ra) / 2; // semi-major axis = 9300 km
    const vPeriapsis = Math.sqrt(MU * (2 / rp - 1 / a)); // ~9.81 km/s

    const r0: [number, number, number] = [rp, 0, 0];
    const v0: [number, number, number] = [0, vPeriapsis, 0];

    const energy0 = (norm(v0) * norm(v0)) / 2 - MU / norm(r0);

    // Sample across different points along the trajectory (1000s, 3000s, 5000s)
    for (const dt of [500, 1500, 3000, 4500]) {
      const state = twoBody(r0, v0, dt);
      const rMag = norm(state.r);
      const vMag = norm(state.v);
      const energy = (vMag * vMag) / 2 - MU / rMag;

      // Energy conservation to 1e-6 relative error
      expect(energy).toBeCloseTo(energy0, 4);
    }
  });

  it('strictly conserves angular momentum vector h = r x v', () => {
    const r0: [number, number, number] = [6800, 200, -100];
    const v0: [number, number, number] = [0.2, 7.5, 1.1];

    const h0 = cross(r0, v0);

    const state = twoBody(r0, v0, 1800);
    const hAfter = cross(state.r, state.v);

    expect(hAfter[0]).toBeCloseTo(h0[0], 3);
    expect(hAfter[1]).toBeCloseTo(h0[1], 3);
    expect(hAfter[2]).toBeCloseTo(h0[2], 3);
  });

  it('accurately evaluates Stumpff functions across parabolic transition', () => {
    // Parabolic boundary: z = 0 -> c(0) = 1/2, s(0) = 1/6
    expect(stumpffC(0)).toBeCloseTo(0.5, 8);
    expect(stumpffS(0)).toBeCloseTo(1 / 6, 8);

    // Small positive z (elliptic transition)
    expect(stumpffC(1e-4)).toBeCloseTo(0.5 - 1e-4 / 24, 7);
    expect(stumpffS(1e-4)).toBeCloseTo(1 / 6 - 1e-4 / 120, 7);

    // Positive z (elliptic)
    const zPos = 1.0;
    expect(stumpffC(zPos)).toBeCloseTo((1 - Math.cos(1.0)) / 1.0, 7);
    expect(stumpffS(zPos)).toBeCloseTo((1.0 - Math.sin(1.0)) / 1.0, 7);

    // Negative z (hyperbolic)
    const zNeg = -1.0;
    expect(stumpffC(zNeg)).toBeCloseTo((Math.cosh(1.0) - 1.0) / 1.0, 7);
    expect(stumpffS(zNeg)).toBeCloseTo((Math.sinh(1.0) - 1.0) / 1.0, 7);
  });
});
