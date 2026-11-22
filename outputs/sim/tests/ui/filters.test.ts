import { describe, it, expect } from 'vitest';
import { filterObjects, type CatalogRowItem } from '../../src/ui/filters';

describe('UI Catalog Filters (filterObjects)', () => {
  const sampleItems: CatalogRowItem[] = [
    { kind: 'sat', index: 0, name: 'IRS-P5 (CARTOSAT-1)', norad: 28649, risk: 'safe' },
    { kind: 'sat', index: 1, name: 'RISAT-2B', norad: 44262, risk: 'safe' },
    { kind: 'deb', index: 0, name: 'COSMOS 2251 DEB #1', norad: 33836, risk: 'safe' },
    { kind: 'deb', index: 1, name: 'COSMOS 2251 DEB #2', norad: 33757, risk: 'warn' },
    { kind: 'deb', index: 2, name: 'FENGYUN 1C DEB #1', norad: 29734, risk: 'crit' },
    { kind: 'deb', index: 3, name: 'FENGYUN 1C DEB #2', norad: 29800, risk: 'safe' },
  ];

  it('filters by active satellite count and debris count', () => {
    // 1 sat active, 2 debris active
    const res = filterObjects(sampleItems, '', 1, 2);
    expect(res.map((r) => r.name)).toEqual([
      'IRS-P5 (CARTOSAT-1)',
      'COSMOS 2251 DEB #1',
      'COSMOS 2251 DEB #2',
    ]);
  });

  it('pins active threat debris even if beyond standard active debris count', () => {
    // active debris is 1 (index 0), but index 2 is active threat
    const res = filterObjects(sampleItems, '', 1, 1, 2);
    expect(res.map((r) => r.norad)).toEqual([
      28649, // Sat (rank 0)
      29734, // Threat debris index 2 (rank 1)
      33836, // Standard debris index 0 (rank 2)
    ]);
  });

  it('filters by query string (case-insensitive name or norad)', () => {
    const byName = filterObjects(sampleItems, 'cartosat');
    expect(byName).toHaveLength(1);
    expect(byName[0].norad).toBe(28649);

    const byNorad = filterObjects(sampleItems, '29734');
    expect(byNorad).toHaveLength(1);
    expect(byNorad[0].name).toContain('FENGYUN 1C');
  });

  it('handles empty list and non-matching query', () => {
    expect(filterObjects([], '')).toEqual([]);
    expect(filterObjects(sampleItems, 'NONEXISTENT_NORAD_99999')).toEqual([]);
  });
});
