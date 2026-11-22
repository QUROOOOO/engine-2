import type { RTNCoords } from '../types/orbital';

export interface BPlaneGridConfig {
  size: number;
  kmRange: number;
  center: number;
  scale: number;
}

export interface BPlanePoint {
  x: number;
  y: number;
  clamped: boolean;
}

export interface BPlaneEllipse {
  sigmaMultiplier: number;
  xRadius: number;
  yRadius: number;
  cx: number;
  cy: number;
}

export function computeBPlaneConfig(canvasSize = 300, kmRange = 6): BPlaneGridConfig {
  const center = canvasSize / 2;
  const padding = 18;
  const scale = (center - padding) / kmRange;
  return {
    size: canvasSize,
    kmRange,
    center,
    scale,
  };
}

/**
 * Projects physical (t, n) coordinates in km onto 2D canvas pixel coordinates.
 * T-axis maps to horizontal (+X)
 * N-axis maps to vertical (-Y, inverted for screen coordinates)
 */
export function projectBPlanePoint(
  tKm: number,
  nKm: number,
  config: BPlaneGridConfig
): BPlanePoint {
  const maxCoord = config.kmRange - 0.1;
  const clampedT = Math.max(-maxCoord, Math.min(maxCoord, tKm));
  const clampedN = Math.max(-maxCoord, Math.min(maxCoord, nKm));

  const x = config.center + clampedT * config.scale;
  const y = config.center - clampedN * config.scale;

  const clamped = clampedT !== tKm || clampedN !== nKm;
  return { x, y, clamped };
}

/**
 * Computes the 1, 2, and 3 sigma covariance ellipse dimensions on the B-plane.
 *
 * @param rt Conjunction RTN coordinates (in km)
 * @param config BPlane grid configuration
 * @param sT Along-track 1-sigma uncertainty (km, default: 0.16)
 * @param sN Cross-track 1-sigma uncertainty (km, default: 0.10)
 */
export function computeBPlaneEllipses(
  rt: RTNCoords | undefined,
  config: BPlaneGridConfig,
  sT = 0.16,
  sN = 0.1
): BPlaneEllipse[] {
  if (!rt) return [];

  const cx = config.center + rt.t * config.scale;
  const cy = config.center - rt.n * config.scale;

  return [1, 2, 3].map(k => ({
    sigmaMultiplier: k,
    xRadius: sT * k * config.scale,
    yRadius: sN * k * config.scale,
    cx,
    cy,
  }));
}

export interface BPlaneData {
  config: BPlaneGridConfig;
  missPoint: BPlanePoint;
  ellipses: BPlaneEllipse[];
  safeRadiusPx: number;
}

export function buildBPlaneData(
  rt: RTNCoords | undefined,
  missKm: number,
  sigmas: { sT?: number; sN?: number } = {},
  canvasSize = 300,
  kmRange = 6
): BPlaneData {
  const config = computeBPlaneConfig(canvasSize, kmRange);
  const t = rt ? rt.t : 0;
  const n = rt ? rt.n : 0;
  const missPoint = projectBPlanePoint(t, n, config);
  const sT = sigmas.sT ?? 0.16;
  const sN = sigmas.sN ?? 0.1;
  const ellipses = computeBPlaneEllipses(rt, config, sT, sN);
  const safeRadiusPx = (Number.isFinite(missKm) ? 5.0 : 5.0) * config.scale;

  return {
    config,
    missPoint,
    ellipses,
    safeRadiusPx,
  };
}
