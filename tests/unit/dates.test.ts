import { describe, it, expect } from 'vitest';
import { resolveRange, toYMD, fromYMD, startOfDayLocal, endOfDayLocal, formatDateBn, formatDateTimeBn, toBanglaDigits } from '../../src/shared/dates';

describe('date ranges (local-time aware)', () => {
  const fixed = new Date(2026, 8, 15, 14, 30).getTime(); // 2026-09-15 14:30 local

  it('today', () => {
    const r = resolveRange('today', fixed);
    expect(toYMD(r.from)).toBe(toYMD(fixed));
    expect(r.to).toBe(endOfDayLocal(fixed));
  });

  it('last7 spans 7 days ending today', () => {
    const r = resolveRange('last7', fixed);
    const days = (startOfDayLocal(r.to) - startOfDayLocal(r.from)) / 86400000 + 1;
    expect(days).toBe(7);
  });

  it('thisMonth starts on the 1st', () => {
    const r = resolveRange('thisMonth', fixed);
    expect(toYMD(r.from)).toBe('2026-09-01');
  });

  it('last3m starts on the 1st of three months back', () => {
    const r = resolveRange('last3m', fixed);
    expect(toYMD(r.from)).toBe('2026-07-01');
  });

  it('last6m starts on the 1st of six months back', () => {
    const r = resolveRange('last6m', fixed);
    expect(toYMD(r.from)).toBe('2026-04-01');
  });

  it('thisYear starts on Jan 1', () => {
    const r = resolveRange('thisYear', fixed);
    expect(toYMD(r.from)).toBe('2026-01-01');
  });

  it('custom range clamps to day boundaries', () => {
    const from = new Date(2026, 8, 1, 9, 0).getTime();
    const to = new Date(2026, 8, 3, 15, 0).getTime();
    const r = resolveRange('custom', fixed, { from, to });
    expect(toYMD(r.from)).toBe('2026-09-01');
    expect(r.to).toBe(endOfDayLocal(to));
  });

  it('round-trips YMD', () => {
    expect(fromYMD(toYMD(fixed))).toBe(startOfDayLocal(fixed));
  });

  it('formats Bangla dates with Bangla digits', () => {
    const out = formatDateBn(fixed);
    expect(out).toContain(toBanglaDigits(15));
    expect(out).toContain(toBanglaDigits(2026));
    expect(/[0-9]/.test(out)).toBe(false);
    const outDt = formatDateTimeBn(fixed);
    expect(outDt).toContain(toBanglaDigits('2:30'));
    expect(outDt.endsWith('PM')).toBe(true);
  });
});
