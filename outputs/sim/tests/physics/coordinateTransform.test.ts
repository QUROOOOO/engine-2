import { describe, it, expect } from 'vitest';
import { rtn, projectRTN, fromRTN } from '../../src/physics/coordinateTransform';
import { norm, dot } from '../../src/physics/math';

describe('RTN Frame Coordinate Transformations', () => {
  it('constructs a strictly orthonormal right-handed basis', () => {
    const r = [6800, 120, -50];
    const v = [0.1, 7.5, 1.2];

    const basis = rtn(r, v);

    // Unit length checks
    expect(norm(basis.R)).toBeCloseTo(1.0, 7);
    expect(norm(basis.T)).toBeCloseTo(1.0, 7);
    expect(norm(basis.N)).toBeCloseTo(1.0, 7);

    // Mutual orthogonality checks
    expect(dot(basis.R, basis.T)).toBeCloseTo(0.0, 7);
    expect(dot(basis.R, basis.N)).toBeCloseTo(0.0, 7);
    expect(dot(basis.T, basis.N)).toBeCloseTo(0.0, 7);
  });

  it('performs exact round-trip conversion between Cartesian and RTN coordinates', () => {
    const rRef = [6900, 0, 0];
    const vRef = [0, 7.6, 0];
    const rRelCartesian = [1.5, -2.0, 0.8]; // km

    const rtnCoords = projectRTN(rRelCartesian, rRef, vRef);
    const roundTrip = fromRTN(rtnCoords, rRef, vRef);

    expect(roundTrip[0]).toBeCloseTo(rRelCartesian[0], 6);
    expect(roundTrip[1]).toBeCloseTo(rRelCartesian[1], 6);
    expect(roundTrip[2]).toBeCloseTo(rRelCartesian[2], 6);
  });
});
