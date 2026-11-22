import { SATS as BASE_SATS, DEBRIS as BASE_DEBRIS, SATS, DEBRIS } from './tle-data';
import type { TLEEntry } from './types/orbital';
import { SAFE_MISS_KM, PC_CRIT, PC_WARN } from './physics/constants';

// Re-export all modular physics functions and constants
export * from './physics/index';

export function riskOf(miss: number, p: number): 'crit' | 'warn' | 'safe' {
  if (miss < 1.0 || p >= (PC_CRIT as number)) return 'crit';
  if (miss < (SAFE_MISS_KM as number) || p >= (PC_WARN as number)) return 'warn';
  return 'safe';
}

export function fmtPc(p: number): string {
  if (!isFinite(p)) return '—';
  if (p === 0 || p < 1e-12) return '<1e-12';
  return p < 0.01 ? p.toExponential(2).replace('e-', 'e−') : p.toFixed(4);
}

export function parseTleText(text: string): TLEEntry[] {
  const lines = String(text)
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.trim());
  const out: TLEEntry[] = [];
  let name: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (l.startsWith('1 ') && lines[i + 1] && lines[i + 1].startsWith('2 ')) {
      const l1 = l;
      const l2 = lines[i + 1];
      const norad = parseInt(l1.slice(2, 7), 10);
      out.push({ name: name || `OBJECT ${norad}`, norad, l1, l2 });
      name = null;
      i++;
      continue;
    }
    name = l;
  }
  return out;
}

export async function fetchLiveTles(): Promise<{ earth: TLEEntry[]; debris: TLEEntry[]; fetchedAt: string } | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch('/api/v1/live/tles', { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || !body.ok || !body.earth) return null;
    const earth = parseTleText(body.earth);
    const cos = parseTleText(body.cosmos || '');
    const fen = parseTleText(body.fengyun || '');
    if (earth.length < 2 || cos.length + fen.length < 20) return null;
    return { earth, debris: [...cos, ...fen], fetchedAt: body.fetchedAt };
  } catch (e) {
    return null;
  }
}

export { SATS, DEBRIS, BASE_SATS, BASE_DEBRIS };
