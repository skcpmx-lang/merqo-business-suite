/**
 * MERQO shared money utilities.
 *
 * All monetary amounts are stored and computed as INTEGER paise
 * (1 BDT = 100 paise). Floating point is never used for money.
 * Conversion to decimal taka happens only at the display boundary.
 */

export type Paise = number;

export const PAISES_PER_TAKA = 100;

/** Convert a decimal-taka amount to integer paise (half-up). */
export function toPaise(taka: number): Paise {
  return roundToPaise(taka);
}

/**
 * Round a raw decimal (e.g. unit price × quantity in taka, or a percentage
 * share) to integer paise with half-up rounding.
 */
export function roundToPaise(value: number): Paise {
  if (!Number.isFinite(value)) throw new Error('invalid money amount');
  return value >= 0
    ? Math.floor(value * PAISES_PER_TAKA + 0.5)
    : -Math.floor(-value * PAISES_PER_TAKA + 0.5);
}

export function fromPaise(paise: Paise): number {
  return paise / PAISES_PER_TAKA;
}

export function addPaise(a: Paise, b: Paise): Paise {
  return a + b;
}

export function subPaise(a: Paise, b: Paise): Paise {
  return a - b;
}

/** Integer-safe multiply of paise by a quantity (quantity may be fractional). */
export function mulPaise(paise: Paise, quantity: number): Paise {
  return roundToPaise(fromPaise(paise) * quantity);
}

/** Percentage of paise, in basis points (1 bp = 0.01%). */
export function percentPaise(paise: Paise, basisPoints: number): Paise {
  return roundToPaise(fromPaise(paise) * (basisPoints / 10000));
}

const BDT_FORMATTER = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/** Format integer paise as Bangladeshi taka: "৳ 12,500.00" (lakh grouping). */
export function formatBdt(paise: Paise, opts?: { compact?: boolean; sign?: boolean }): string {
  const value = fromPaise(paise);
  let text: string;
  if (opts?.compact) {
    const abs = Math.abs(value);
    if (abs >= 10_000_000) text = `${BDT_FORMATTER.format(value / 1_000_000)} মিলিয়ন`;
    else if (abs >= 100_000) text = `${BDT_FORMATTER.format(value / 100_000)} লক্ষ`;
    else if (abs >= 1_000) text = `${BDT_FORMATTER.format(value / 1_000)} হাজার`;
    else text = BDT_FORMATTER.format(value);
  } else {
    text = BDT_FORMATTER.format(value);
  }
  if (value < 0) return `−৳ ${text.replace('-', '')}`;
  if (opts?.sign && value > 0) return `+৳ ${text}`;
  return `৳ ${text}`;
}

/** Parse a user-entered decimal amount (e.g. "1250.5") to integer paise. */
export function parseTaka(input: string | number): Paise {
  if (typeof input === 'number') return roundToPaise(input);
  const cleaned = input.replace(/[৳\s,]/g, '');
  if (cleaned === '') return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new Error('invalid money amount');
  return roundToPaise(value);
}
