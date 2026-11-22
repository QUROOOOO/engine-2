import { describe, it, expect } from 'vitest';
import {
  formatPc,
  formatMiss,
  formatDv,
  riskClass,
  fmtFuel,
  fmtMet,
  fmtTimeToTca,
  fmtLeadTime,
  fmtAge,
  escapeHtml,
} from '../../src/ui/formatters';

describe('UI Formatters & Risk Classification', () => {
  describe('formatPc', () => {
    it('formats normal and boundary Pc values', () => {
      expect(formatPc(0.05)).toBe('0.0500');
      expect(formatPc(1e-4)).toBe('1.00e−4');
      expect(formatPc(1.23e-6)).toBe('1.23e−6');
    });

    it('handles zero and negligible probability bounds', () => {
      expect(formatPc(0)).toBe('<1e-12');
      expect(formatPc(1e-15)).toBe('<1e-12');
    });

    it('handles invalid inputs, null, and NaN', () => {
      expect(formatPc(null)).toBe('—');
      expect(formatPc(undefined)).toBe('—');
      expect(formatPc(NaN)).toBe('—');
      expect(formatPc(Infinity)).toBe('—');
    });
  });

  describe('formatMiss', () => {
    it('formats valid miss distances with 3 decimals', () => {
      expect(formatMiss(0.428)).toBe('0.428 km');
      expect(formatMiss(5)).toBe('5.000 km');
      expect(formatMiss(0)).toBe('0.000 km');
    });

    it('handles null, undefined, and NaN values', () => {
      expect(formatMiss(null)).toBe('—');
      expect(formatMiss(undefined)).toBe('—');
      expect(formatMiss(NaN)).toBe('—');
    });
  });

  describe('formatDv', () => {
    it('formats delta-v in m/s', () => {
      expect(formatDv(1.45)).toBe('1.45 m/s');
      expect(formatDv(0)).toBe('0.00 m/s');
    });

    it('handles invalid inputs', () => {
      expect(formatDv(null)).toBe('—');
      expect(formatDv(NaN)).toBe('—');
    });
  });

  describe('escapeHtml', () => {
    it('escapes special HTML characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(escapeHtml("Tom & 'Jerry'")).toBe('Tom &amp; &#39;Jerry&#39;');
    });

    it('handles null, undefined, and non-string inputs safely', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml(123 as any)).toBe('123');
    });
  });

  describe('riskClass', () => {
    it('classifies critical risk (miss < 1.0 km or Pc >= 1e-3)', () => {
      expect(riskClass(0.5, 1e-5)).toBe('crit');
      expect(riskClass(2.0, 1e-3)).toBe('crit');
      expect(riskClass(0.99, 0)).toBe('crit');
    });

    it('classifies warning risk (miss < 5.0 km or Pc >= 1e-4)', () => {
      expect(riskClass(3.5, 1e-6)).toBe('warn');
      expect(riskClass(10.0, 2e-4)).toBe('warn');
      expect(riskClass(4.99, 1e-7)).toBe('warn');
    });

    it('classifies safe passes (miss >= 5.0 km and Pc < 1e-4)', () => {
      expect(riskClass(5.0, 1e-5)).toBe('safe');
      expect(riskClass(15.2, 0)).toBe('safe');
    });

    it('handles invalid or non-finite inputs gracefully as safe', () => {
      expect(riskClass(NaN, 1e-3)).toBe('safe');
      expect(riskClass(0.5, NaN)).toBe('safe');
      expect(riskClass(Infinity, Infinity)).toBe('safe');
    });
  });

  describe('auxiliary formatters', () => {
    it('formats fuel clamp to zero on negative', () => {
      expect(fmtFuel(12.5)).toBe('12.50 m/s');
      expect(fmtFuel(-5)).toBe('0.00 m/s');
      expect(fmtFuel(null)).toBe('—');
    });

    it('formats MET hours, minutes, seconds', () => {
      expect(fmtMet(0)).toBe('00:00:00');
      expect(fmtMet(3661000)).toBe('01:01:01');
    });

    it('formats time to TCA and lead time', () => {
      expect(fmtTimeToTca(120)).toBe('T−2.00 h');
      expect(fmtTimeToTca(25)).toBe('T−25.0 min');
      expect(fmtTimeToTca(-1)).toBe('PASSED');
      expect(fmtLeadTime(90)).toBe('1.50 h');
      expect(fmtLeadTime(-5)).toBe('—');
      expect(fmtAge(1.234)).toBe('1.2');
      expect(fmtAge(null)).toBe('—');
    });
  });
});
