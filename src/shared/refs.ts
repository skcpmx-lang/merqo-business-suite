/**
 * Reference-number formatting. Human-facing sequential references
 * (INV-000001, PUR-000001, REC-000001 …) are allocated from a per-prefix
 * sequence table inside the same DB transaction as the document, so numbers
 * are unique and never casually reused (§83, §84).
 */
export function formatReference(prefix: string, n: number, width = 6): string {
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

export const REF_PREFIX = {
  sale: 'INV',
  purchase: 'PUR',
  customerPayment: 'CPY',
  supplierPayment: 'SPY',
  saleReturn: 'RIN',
  purchaseReturn: 'RPU',
  accountTransfer: 'TRF',
  expense: 'EXP',
  mfs: 'MFS',
  stockAdjustment: 'STA',
  cashSession: 'SHIFT'
} as const;
