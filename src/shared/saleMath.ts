/**
 * Pure sale-price math shared by the domain service and the POS preview.
 * Keeping the proration + tax formulas in one place guarantees the amount
 * shown on screen is exactly the amount recorded on the bill (§120).
 *
 * All values are integer paise; no floating point is persisted.
 */
import { roundToPaise, fromPaise, percentPaise, type Paise } from './money';

export interface SaleFinSettings {
  tax_enabled: boolean;
  tax_rate_bps: number;
  tax_inclusive_prices: boolean;
}

export interface PreviewLine {
  quantity: number;
  unitPricePaise: Paise;
  /** line-level discount (optional) */
  discountPaise?: Paise;
}

export interface SaleTotals {
  subtotal: Paise;
  discount: Paise;
  tax: Paise;
  total: Paise;
}

/** Tax on a pre-discount base using the business tax settings. */
export function taxForBase(base: Paise, fin: SaleFinSettings): Paise {
  if (!fin.tax_enabled || fin.tax_rate_bps <= 0 || base <= 0) return 0;
  return fin.tax_inclusive_prices
    // base is already integer paise; base·bps/(10000+bps) is the tax in
    // paise — rounding once is all that's needed (NO ×100).
    ? Math.round((base * fin.tax_rate_bps) / (10000 + fin.tax_rate_bps))
    : percentPaise(base, fin.tax_rate_bps);
}

/**
 * Split an order-level discount across lines proportional to each line's
 * pre-discount base (gross − line discount). Paise are rounded per line and
 * any rounding remainder is assigned to the line with the largest base, so
 * the parts always sum exactly to the whole.
 */
export function prorateOrderDiscount(
  bases: Paise[],
  orderDiscount: Paise
): Paise[] {
  const out = bases.map(() => 0);
  if (orderDiscount <= 0) return out;
  const totalBase = bases.reduce((s, b) => s + b, 0);
  if (totalBase <= 0) {
    // nothing to prorate over — put it all on the first line
    out[0] = orderDiscount;
    return out;
  }
  let allocated = 0;
  for (let i = 0; i < bases.length; i++) {
    out[i] = Math.round((bases[i] * orderDiscount) / totalBase);
    allocated += out[i];
  }
  // rounding remainder → largest base line (or first)
  const remainder = orderDiscount - allocated;
  if (remainder !== 0) {
    let idx = 0;
    for (let i = 1; i < bases.length; i++) if (bases[i] > bases[idx]) idx = i;
    out[idx] += remainder;
  }
  return out;
}

/**
 * Preview totals for a set of lines + order discount + tax settings.
 * Mirrors the domain computation exactly (per-line tax after proration).
 */
export function previewSaleTotals(
  lines: PreviewLine[],
  fin: SaleFinSettings,
  orderDiscountPaise: Paise
): SaleTotals {
  // Same formula as the domain (computeLines): paise → taka × qty → paise,
  // so the preview and the recorded bill can never diverge (§120).
  const gross = lines.map((l) => roundToPaise(fromPaise(l.unitPricePaise) * l.quantity));
  const lineDisc = lines.map((l) => l.discountPaise ?? 0);
  const bases = gross.map((g, i) => Math.max(0, g - lineDisc[i]));
  const alloc = prorateOrderDiscount(bases, Math.min(orderDiscountPaise, bases.reduce((s, b) => s + b, 0)));

  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    subtotal += gross[i];
    discount += lineDisc[i] + alloc[i];
    const netBase = bases[i] - alloc[i];
    const t = taxForBase(netBase, fin);
    tax += t;
    total += netBase + t;
  }
  return { subtotal, discount, tax, total };
}
