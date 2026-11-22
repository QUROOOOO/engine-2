/**
 * Pure 3D Euclidean vector algebra functions.
 */

export const norm = (v: readonly number[]): number => Math.hypot(v[0], v[1], v[2]);

export const sub = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];

export const add = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];

export const dot = (a: readonly number[], b: readonly number[]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const scale = (a: readonly number[], s: number): [number, number, number] => [
  a[0] * s,
  a[1] * s,
  a[2] * s,
];

export const unit = (a: readonly number[]): [number, number, number] => {
  const n = norm(a) || 1;
  return scale(a, 1 / n);
};

export const isFiniteVec = (v: readonly number[]): boolean =>
  v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
