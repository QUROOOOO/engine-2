import type { RiskLevel } from './riskClassifier';

export interface CatalogRowItem {
  kind: 'sat' | 'deb';
  index: number;
  name: string;
  norad: number;
  risk: RiskLevel;
  lifecycle?: 'ACTIVE' | 'COLLIDING' | 'DISSOLVING' | 'REMOVED';
}

/**
 * Pure function that filters and sorts space objects for the sidebar list.
 *
 * Rules:
 * 1. Satellites are filtered by active satN count.
 * 2. Debris objects are filtered by active debN count, EXCEPT if a debris object is the active threat.
 * 3. Search query filters by substring matching against object name (case-insensitive) or NORAD ID.
 * 4. Priority ordering:
 *    - Primary assets (rank 0)
 *    - Active threat debris (rank 1)
 *    - Standard debris (rank 2)
 *    - Preserves deterministic index tie-breaking.
 */
export function filterObjects(
  items: readonly CatalogRowItem[],
  query: string,
  satN = Infinity,
  debN = Infinity,
  threatIndex?: number,
  limit = 180
): CatalogRowItem[] {
  const q = query.trim().toLowerCase();
  const isThreat = (o: CatalogRowItem) => o.kind === 'deb' && o.index === threatIndex;
  const rank = (o: CatalogRowItem) => (o.kind === 'sat' ? 0 : isThreat(o) ? 1 : 2);

  return items
    .filter(o => (o.kind === 'sat' ? o.index < satN : o.index < debN || isThreat(o)))
    .filter(o => !q || o.name.toLowerCase().includes(q) || String(o.norad).includes(q))
    .sort((a, b) => rank(a) - rank(b) || a.index - b.index)
    .slice(0, limit);
}
