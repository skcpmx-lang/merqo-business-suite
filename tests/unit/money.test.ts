import { describe, it, expect } from 'vitest';
import { toPaise, roundToPaise, formatBdt, parseTaka, mulPaise, percentPaise } from '../../src/shared/money';

describe('money (integer paise)', () => {
  it('converts taka to paise with half-up rounding', () => {
    expect(toPaise(125.5)).toBe(12550);
    expect(toPaise(0.005)).toBe(1); // 0.5 paise → 1 (half-up)
    expect(toPaise(0.004)).toBe(0);
    expect(toPaise(0.015)).toBe(2); // 1.5 paise → 2 (half-up)
    expect(toPaise(-5.55)).toBe(-555);
  });

  it('rounds fractional paise half-up (e.g. 1/3 taka shares)', () => {
    expect(roundToPaise(10 / 3)).toBe(333); // 333.33…
    expect(roundToPaise(100 / 3)).toBe(3333); // 3333.33…
    expect(roundToPaise(10 / 3 + 0.005)).toBe(334); // 333.83… → 334
    expect(roundToPaise(-10 / 3)).toBe(-333);
  });

  it('multiplies paise by fractional quantity without float drift', () => {
    expect(mulPaise(999, 3)).toBe(2997);
    expect(mulPaise(12345, 0.15)).toBe(1852); // 1851.75 → 1852
    expect(mulPaise(100, 1 / 3)).toBe(33); // 33.33 → 33
  });

  it('computes percentages in basis points', () => {
    expect(percentPaise(10000, 500)).toBe(500); // 5%
    expect(percentPaise(101, 100)).toBe(1); // 1% of 101 → 1.01 → 1
    expect(percentPaise(199, 100)).toBe(2); // 1.99 → 2
  });

  it('formats BDT with ৳ and lakh grouping', () => {
    expect(formatBdt(1250000)).toBe('৳ 12,500.00');
    expect(formatBdt(123456789)).toBe('৳ 12,34,567.89'); // lakh grouping
    expect(formatBdt(-50000)).toBe('−৳ 500.00');
    expect(formatBdt(0)).toBe('৳ 0.00');
  });

  it('parses user input robustly', () => {
    expect(parseTaka('1250.5')).toBe(125050);
    expect(parseTaka('৳ 12,500')).toBe(1250000);
    expect(parseTaka('')).toBe(0);
    expect(() => parseTaka('abc')).toThrow();
  });
});
