/**
 * Pure display formatting functions for astronomical and conjunction UI readouts.
 */

export function fmt(v: number | undefined | null, d = 1): string {
  return v != null && Number.isFinite(v) ? v.toFixed(d) : '—';
}

export function fmtMiss(km: number | undefined | null): string {
  if (km == null || !Number.isFinite(km)) return '—';
  return `${fmt(km, 3)} km`;
}

export function fmtRelSpeed(kms: number | undefined | null): string {
  if (kms == null || !Number.isFinite(kms)) return '—';
  return `${fmt(kms, 2)} km/s`;
}

export function fmtDv(mps: number | undefined | null): string {
  if (mps == null || !Number.isFinite(mps)) return '—';
  return `${fmt(mps, 2)} m/s`;
}

export function fmtFuel(mps: number | undefined | null): string {
  if (mps == null || !Number.isFinite(mps)) return '—';
  return `${fmt(Math.max(0, mps), 2)} m/s`;
}

export function fmtPc(p: number | undefined | null): string {
  if (p == null || !Number.isFinite(p)) return '—';
  if (p === 0 || p < 1e-12) return '<1e-12';
  return p < 0.01 ? p.toExponential(2).replace('e-', 'e−') : p.toFixed(4);
}

export function fmtPcCompact(p: number | undefined | null): string {
  if (p == null || !Number.isFinite(p)) return '—';
  if (p < 1e-12) return '<1e-12';
  return p.toExponential(1).replace('e-', 'e−');
}

export function fmtAge(days: number | undefined | null): string {
  if (days == null || !Number.isFinite(days)) return '—';
  return days.toFixed(1);
}

export function fmtMet(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function fmtTimeToTca(tcaMin: number): string {
  if (tcaMin < 0) return 'PASSED';
  if (tcaMin >= 60) return `T−${fmt(tcaMin / 60, 2)} h`;
  return `T−${fmt(tcaMin, 1)} min`;
}

export function fmtLeadTime(burnMin: number): string {
  if (burnMin < 0) return '—';
  return `${fmt(burnMin / 60, 2)} h`;
}

/**
 * Escapes untrusted user or remote strings for safe DOM embedding.
 */
export function escapeHtml(str: string | undefined | null): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Aliases matching specification
export {
  fmtPc as formatPc,
  fmtMiss as formatMiss,
  fmtDv as formatDv,
};
export { classifyRisk as riskClass, classifyRisk } from './riskClassifier';

