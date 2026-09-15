/**
 * Migration 0002 — system catalogs.
 *
 * Seeded system data (permissions catalog). Business-scoped defaults
 * (roles, units, expense categories, MFS providers, system accounts) are
 * created per business by the setup service so each business is self-contained.
 */
import { PERMISSIONS } from '../../../shared/permissions';

export const m0002_seed_system = `
-- Permissions catalog (global). Rows come from the shared permission list;
-- the seed inserts are generated below at migration time by the runner
-- (see seedPermissions in this module) — the raw SQL below creates the table.

CREATE TABLE IF NOT EXISTS permissions (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT 'general'
);
`;

/** Insert the permission catalog rows (idempotent). Called after the SQL above. */
export function seedPermissions(db: import('better-sqlite3').Database): void {
  const groups: Record<string, string> = {
    sales: 'বিক্রয়',
    purchases: 'ক্রয়',
    products: 'পণ্য ও ইনভেন্টরি',
    stock: 'পণ্য ও ইনভেন্টরি',
    customers: 'কাস্টমার ও সাপ্লায়ার',
    suppliers: 'কাস্টমার ও সাপ্লায়ার',
    profit: 'ফিন্যান্স',
    expenses: 'ফিন্যান্স',
    accounts: 'ফিন্যান্স',
    shift: 'ফিন্যান্স',
    mfs: 'MFS এজেন্ট',
    reports: 'রিপোর্ট ও ডকুমেন্ট',
    invoices: 'রিপোর্ট ও ডকুমেন্ট',
    exports: 'রিপোর্ট ও ডকুমেন্ট',
    imports: 'রিপোর্ট ও ডকুমেন্ট',
    notifications: 'সিস্টেম',
    users: 'অ্যাডমিনিস্ট্রেশন',
    settings: 'অ্যাডমিনিস্ট্রেশন',
    backup: 'অ্যাডমিনিস্ট্রেশন',
    audit: 'অ্যাডমিনিস্ট্রেশন',
    data: 'অ্যাডমিনিস্ট্রেশন'
  };
  const insert = db.prepare(
    'INSERT OR IGNORE INTO permissions (key, label, group_name) VALUES (?, ?, ?)'
  );
  for (const p of PERMISSIONS) {
    const group = p.key.split('.')[0];
    insert.run(p.key, p.label, groups[group] ?? 'general');
  }
}
