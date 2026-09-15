/** Settings repository — typed key/value configuration per business. */
import type { DB } from '../db/connection';
import { generateId } from '../../shared/ids';

export interface SettingRow {
  section: string;
  key: string;
  value: string;
}

export function getSetting<T>(db: DB, businessId: string, section: string, key: string, fallback: T): T {
  const row = db
    .prepare('SELECT value FROM settings WHERE business_id = ? AND section = ? AND key = ?')
    .get(businessId, section, key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(
  db: DB,
  businessId: string,
  section: string,
  key: string,
  value: unknown,
  userId?: string
): void {
  db.prepare(
    `INSERT INTO settings (id, business_id, section, key, value, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (business_id, section, key)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = COALESCE(excluded.updated_by, settings.updated_by)`
  ).run(generateId(), businessId, section, key, JSON.stringify(value), Date.now(), userId ?? null);
}

export function getSectionSettings(db: DB, businessId: string, section: string): Record<string, unknown> {
  const rows = db
    .prepare('SELECT key, value FROM settings WHERE business_id = ? AND section = ?')
    .all(businessId, section) as { key: string; value: string }[];
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

export function listAllSettings(db: DB, businessId: string): SettingRow[] {
  return db
    .prepare('SELECT section, key, value FROM settings WHERE business_id = ? ORDER BY section, key')
    .all(businessId) as SettingRow[];
}

/** Typed defaults for well-known settings (documented source of truth). */
export const SETTINGS_DEFAULTS = {
  financial: {
    currency: 'BDT',
    decimals: 2,
    tax_enabled: false,
    tax_rate_bps: 0,
    tax_inclusive_prices: false,
    allow_negative_stock: false,
    allow_negative_accounts: false,
    block_sale_expired: true
  },
  pos: {
    auto_print: false,
    default_paper: '80mm',
    default_customer_mode: 'walkin'
  },
  invoice: {
    prefix: 'INV',
    width: 6,
    show_customer_info: true,
    footer: 'ধন্যবাদ! আবার আসবেন।'
  },
  printer: {
    default_printer: '',
    default_paper: '80mm'
  },
  barcode: {
    input_mode: 'auto'
  },
  notifications: {
    low_stock_enabled: true,
    customer_due_enabled: true,
    supplier_payable_enabled: true,
    expiring_days: 30,
    large_transaction_paise: 5000000,
    unusual_discount_bps: 2500,
    backup_reminder_days: 7
  },
  security: {
    auto_lock_minutes: 30,
    max_failed_logins: 5,
    lockout_minutes: 10
  },
  backup: {
    directory: '',
    auto_enabled: false,
    auto_interval_days: 7
  }
} as const;

export function getFinancialSettings(db: DB, businessId: string) {
  return { ...SETTINGS_DEFAULTS.financial, ...getSectionSettings(db, businessId, 'financial') } as {
    currency: string;
    decimals: number;
    tax_enabled: boolean;
    tax_rate_bps: number;
    tax_inclusive_prices: boolean;
    allow_negative_stock: boolean;
    allow_negative_accounts: boolean;
    block_sale_expired: boolean;
    [k: string]: unknown;
  };
}
