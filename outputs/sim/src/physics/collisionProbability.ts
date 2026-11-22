import type { Probability } from '../types/units';

/**
 * Computes 2D collision probability (Pc) on the encounter B-plane using
 * the Foster-Chan analytical approximation assuming isotropic/aligned Gaussian covariances.
 *
 * @param alongKm Miss distance component along-track / T-axis (km)
 * @param normalKm Miss distance component cross-track / N-axis (km)
 * @param leadH Time to Time-of-Closest-Approach (hours) to expand positional covariance
 * @param combinedHardBodyRadiusKm Combined physical collision radius in km (default: 5.5 meters = 0.0055 km)
 * @returns Dimensionless collision probability (0.0 to 1.0)
 */
export function pc(
  alongKm: number,
  normalKm: number,
  leadH: number,
  combinedHardBodyRadiusKm = 0.0055
): Probability {
  // Positional 1-sigma uncertainty grows linearly with lead time (along-track error dominates)
  const sT = 0.08 + 0.02 * Math.max(0, leadH); // Along-track 1-sigma (km)
  const sN = 0.05 + 0.01 * Math.max(0, leadH); // Cross-track 1-sigma (km)

  const r = combinedHardBodyRadiusKm;
  const exponent = -0.5 * ((alongKm * alongKm) / (sT * sT) + (normalKm * normalKm) / (sN * sN));
  const probability = ((r * r) / (2 * sT * sN)) * Math.exp(exponent);

  return Math.min(1.0, Math.max(0.0, probability)) as Probability;
}
