import { SAFE_MISS_KM, PC_CRIT, PC_WARN } from '../physics/constants';

export type RiskLevel = 'crit' | 'warn' | 'safe';

/**
 * Classifies the risk level of an encounter based on miss distance and collision probability.
 *
 * - 'crit': miss < 1.0 km OR Pc >= 1e-3
 * - 'warn': miss < 5.0 km OR Pc >= 1e-4
 * - 'safe': miss >= 5.0 km AND Pc < 1e-4
 */
export function classifyRisk(missKm: number, pcVal: number): RiskLevel {
  if (!Number.isFinite(missKm) || !Number.isFinite(pcVal)) return 'safe';
  if (missKm < 1.0 || pcVal >= (PC_CRIT as number)) return 'crit';
  if (missKm < (SAFE_MISS_KM as number) || pcVal >= (PC_WARN as number)) return 'warn';
  return 'safe';
}

export function formatRiskLabel(risk: RiskLevel): string {
  switch (risk) {
    case 'crit':
      return 'CRITICAL';
    case 'warn':
      return 'WARNING';
    case 'safe':
    default:
      return 'NOMINAL';
  }
}
