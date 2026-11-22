/**
 * Stumpff functions c(z) and s(z) used in universal Kepler propagation.
 * Evaluates trigonometric (elliptic), hyperbolic (hyperbolic), or series expansions (near parabolic).
 */

export function stumpffC(z: number): number {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (1 - Math.cos(s)) / z;
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.cosh(s) - 1) / -z;
  }
  // Series expansion: 1/2! - z/4! + z^2/6! - ...
  return 0.5 - z / 24 + (z * z) / 720;
}

export function stumpffS(z: number): number {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  // Series expansion: 1/3! - z/5! + z^2/7! - ...
  return 1 / 6 - z / 120 + (z * z) / 5040;
}
