/**
 * Payment method catalog (§32, §19). MFS methods are ordinary business
 * payment instruments — conceptually separate from MFS agent operations
 * (§118). The UI and domain always reference methods by stable key.
 */
export const PAYMENT_METHODS = [
  { key: 'cash', label: 'নগদ', icon: 'banknote' },
  { key: 'bank', label: 'ব্যাংক', icon: 'landmark' },
  { key: 'bkash', label: 'bKash', icon: 'smartphone' },
  { key: 'nagad', label: 'Nagad', icon: 'smartphone' },
  { key: 'rocket', label: 'Rocket', icon: 'smartphone' },
  { key: 'upay', label: 'Upay', icon: 'smartphone' },
  { key: 'cheque', label: 'চেক', icon: 'file-text' },
  { key: 'other', label: 'অন্যান্য', icon: 'more-horizontal' }
] as const;

export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]['key'];

export function paymentMethodLabel(key: string): string {
  return PAYMENT_METHODS.find((m) => m.key === key)?.label ?? key;
}

/** Methods that move real money in/out of a business account. */
export const ACCOUNT_AFFECTING_METHODS: ReadonlySet<string> = new Set([
  'cash', 'bank', 'bkash', 'nagad', 'rocket', 'upay', 'other'
]);

/** Cheque is a contingent settlement — recorded, but not cleared cash by default (§115). */
export const CHEQUE_METHOD = 'cheque';
