import type { TLEEntry } from '../types/orbital';

export function parseTleText(text: string): TLEEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const entries: TLEEntry[] = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].startsWith('1 ') && i + 1 < lines.length && lines[i + 1].startsWith('2 ')) {
      const name =
        i > 0 && !lines[i - 1].startsWith('1 ') && !lines[i - 1].startsWith('2 ')
          ? lines[i - 1]
          : 'OBJECT';
      const norad = parseInt(lines[i].slice(2, 7).trim(), 10) || 0;
      entries.push({ name, norad, l1: lines[i], l2: lines[i + 1] });
      i += 2;
    } else if (
      i + 2 < lines.length &&
      lines[i + 1].startsWith('1 ') &&
      lines[i + 2].startsWith('2 ')
    ) {
      const norad = parseInt(lines[i + 1].slice(2, 7).trim(), 10) || 0;
      entries.push({ name: lines[i], norad, l1: lines[i + 1], l2: lines[i + 2] });
      i += 3;
    } else {
      i++;
    }
  }
  return entries;
}

export async function fetchLiveTles(): Promise<{
  earth: TLEEntry[];
  debris: TLEEntry[];
  fetchedAt: string;
} | null> {
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
    const fng = parseTleText(body.fengyun || '');
    return {
      earth,
      debris: [...cos, ...fng],
      fetchedAt: body.fetchedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
