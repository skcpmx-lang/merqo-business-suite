/**
 * Business setup service — creates a complete, self-contained business
 * workspace: business record, admin user, roles/permissions, system units,
 * expense categories, MFS providers + agent wallets, system accounts with
 * opening balances, and default settings. One atomic transaction.
 *
 * Starts with NO fake business data — only system configuration (§128).
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { recordAudit } from './auditService';
import { setSetting } from '../repos/settings';
import { insertCategory, insertUnit } from '../repos/master';
import { ValidationError } from '../errors';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_CATALOG, type RoleKey } from '../../shared/permissions';

export interface CreateBusinessInput {
  name: string;
  ownerName: string;
  phone?: string;
  email?: string;
  address?: string;
  businessType?: string;
  logoDataUrl?: string | null;
  adminUsername: string;
  adminPassword: string;
  openingBalances?: {
    cash?: number;
    bank?: number;
    bkash?: number;
    nagad?: number;
    rocket?: number;
    upay?: number;
  };
  at?: number;
}

export const SYSTEM_UNITS: [string, string][] = [
  ['পিস', 'pc'], ['কেজি', 'kg'], ['গ্রাম', 'g'], ['লিটার', 'l'], ['মিলিলিটার', 'ml'],
  ['বক্স', 'box'], ['প্যাকেট', 'pack'], ['ডজন', 'dz'], ['রোল', 'roll'], ['বুকেট', 'bucket'],
  ['শীট', 'sheet'], ['কিট', 'kit']
];

export const SYSTEM_EXPENSE_CATEGORIES: [string, number][] = [
  ['ভাড়া', 1], ['বিদ্যুৎ বিল', 2], ['বেতন', 3], ['পরিবহন', 4], ['ইন্টারনেট', 5],
  ['রক্ষণাবেক্ষণ', 6], ['প্যাকেজিং', 7], ['গৃহস্থালি', 8], ['স্বাস্থ্য', 9], ['অন্যান্য', 10]
];

export const SYSTEM_MFS_PROVIDERS: [string, string][] = [
  ['bkash', 'bKash'], ['nagad', 'Nagad'], ['rocket', 'Rocket'], ['upay', 'Upay']
];

export const SYSTEM_ACCOUNTS: { name: string; kind: string; mfs?: string; sort: number }[] = [
  { name: 'নগদ', kind: 'cash', sort: 1 },
  { name: 'ব্যাংক', kind: 'bank', sort: 2 },
  { name: 'bKash', kind: 'mfs', mfs: 'bkash', sort: 3 },
  { name: 'Nagad', kind: 'mfs', mfs: 'nagad', sort: 4 },
  { name: 'Rocket', kind: 'mfs', mfs: 'rocket', sort: 5 },
  { name: 'Upay', kind: 'mfs', mfs: 'upay', sort: 6 }
];

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const computed = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function createBusiness(db: DB, input: CreateBusinessInput): { businessId: string; adminUserId: string } {
  if (!input.name?.trim()) throw new ValidationError('ব্যবসার নাম দিন।');
  if (!input.ownerName?.trim()) throw new ValidationError('মালিক/ব্যবসায়ীর নাম দিন।');
  if (!input.adminUsername?.trim()) throw new ValidationError('ইউজারনেম দিন।');
  if (!input.adminPassword || input.adminPassword.length < 4) {
    throw new ValidationError('কমপক্ষে ৪ অক্ষরের পাসওয়ার্ড দিন।');
  }

  const at = input.at ?? Date.now();
  const businessId = generateId();
  let adminUserId = '';

  tx(db, () => {
    // 1. Business
    db.prepare(
      `INSERT INTO businesses (id, name, owner_name, phone, email, address, business_type, logo_data_url, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      businessId, input.name.trim(), input.ownerName.trim(), input.phone ?? '', input.email ?? '',
      input.address ?? '', input.businessType ?? 'retail', input.logoDataUrl ?? null, at, at
    );

    // 2. Roles + permissions
    const roleIds: Record<string, string> = {};
    const insRole = db.prepare(
      'INSERT INTO roles (id, business_id, key, name, description, is_system, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
    );
    const insPerm = db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const role of ROLE_CATALOG) {
      const roleId = generateId();
      roleIds[role.key] = roleId;
      insRole.run(roleId, businessId, role.key, role.label, role.description, at);
      for (const p of DEFAULT_ROLE_PERMISSIONS[role.key as RoleKey]) {
        insPerm.run(roleId, p);
      }
    }

    // 3. Admin user
    const salt = randomBytes(16).toString('hex');
    adminUserId = generateId();
    db.prepare(
      `INSERT INTO users (id, business_id, name, username, password_hash, password_salt, role_id,
                          is_active, is_owner, must_change_password, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?, ?)`
    ).run(
      adminUserId, businessId, input.ownerName.trim(), input.adminUsername.trim().toLowerCase(),
      hashPassword(input.adminPassword, salt), salt, roleIds.owner, at, at, adminUserId
    );

    // 4. System units
    for (const [name, code] of SYSTEM_UNITS) insertUnit(db, businessId, name, code, true);

    // 5. System expense categories
    for (const [name, sort] of SYSTEM_EXPENSE_CATEGORIES) {
      insertCategoryExpense(db, businessId, name, sort);
    }

    // 6. MFS providers + agent wallets (zero balance — no fake data)
    const providerIds: Record<string, string> = {};
    SYSTEM_MFS_PROVIDERS.forEach(([key, name], i) => {
      const pid = generateId();
      providerIds[key] = pid;
      db.prepare(
        'INSERT INTO mfs_providers (id, business_id, key, name, is_active, sort, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
      ).run(pid, businessId, key, name, i + 1, at);
      db.prepare(
        'INSERT INTO mfs_wallets (id, business_id, provider_id, account_no, opening_balance_paise, balance_paise, is_active, created_at) VALUES (?, ?, ?, ?, 0, 0, 1, ?)'
      ).run(generateId(), businessId, pid, '', at);
    });

    // 7. System accounts with opening balances
    const openings = input.openingBalances ?? {};
    const openMap: Record<string, number> = {
      cash: openings.cash ?? 0,
      bank: openings.bank ?? 0,
      bkash: openings.bkash ?? 0,
      nagad: openings.nagad ?? 0,
      rocket: openings.rocket ?? 0,
      upay: openings.upay ?? 0
    };
    for (const acc of SYSTEM_ACCOUNTS) {
      const opening = openMap[acc.name === 'নগদ' ? 'cash' : acc.name === 'ব্যাংক' ? 'bank' : (acc.mfs ?? '')] ?? 0;
      const accId = generateId();
      db.prepare(
        `INSERT INTO accounts (id, business_id, name, kind, mfs_provider, opening_balance_paise, balance_paise, is_system, is_active, sort, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
      ).run(accId, businessId, acc.name, acc.kind, acc.mfs ?? null, opening, opening, acc.sort, at);
      if (opening !== 0) {
        db.prepare(
          `INSERT INTO account_transactions (id, business_id, account_id, transaction_type, amount_paise, balance_after_paise, note, user_id, created_at)
           VALUES (?, ?, ?, 'opening', ?, ?, 'প্রারম্ভিক ব্যালেন্স', ?, ?)`
        ).run(generateId(), businessId, accId, opening, opening, adminUserId, at);
      }
    }

    // 8. Default settings
    setSetting(db, businessId, 'invoice', 'prefix', 'INV', adminUserId);
    setSetting(db, businessId, 'financial', 'currency', 'BDT', adminUserId);
    setSetting(db, businessId, 'printer', 'default_paper', '80mm', adminUserId);
    setSetting(db, businessId, 'pos', 'default_paper', '80mm', adminUserId);

    // 9. Audit
    recordAudit(db, {
      businessId,
      userId: adminUserId,
      action: 'business.create',
      entityType: 'business',
      entityId: businessId,
      after: { name: input.name.trim(), owner: input.ownerName.trim() },
      at
    });
  });

  return { businessId, adminUserId };
}

function insertCategoryExpense(db: DB, businessId: string, name: string, sort: number): void {
  db.prepare(
    'INSERT INTO expense_categories (id, business_id, name, is_system, sort, is_active, created_at) VALUES (?, ?, ?, 1, ?, 1, ?)'
  ).run(generateId(), businessId, name, sort, Date.now());
}

export function getBusiness(db: DB, businessId: string) {
  return db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId) as
    | Record<string, unknown>
    | undefined;
}

export function getActiveBusiness(db: DB): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM businesses WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1').get() as
    | Record<string, unknown>
    | undefined;
}

export function updateBusiness(
  db: DB,
  businessId: string,
  patch: Partial<Pick<CreateBusinessInput, 'name' | 'ownerName' | 'phone' | 'email' | 'address' | 'businessType' | 'logoDataUrl'>>,
  userId?: string
): void {
  const map: [keyof typeof patch, string][] = [
    ['name', 'name'], ['ownerName', 'owner_name'], ['phone', 'phone'],
    ['email', 'email'], ['address', 'address'], ['businessType', 'business_type'],
    ['logoDataUrl', 'logo_data_url']
  ];
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [Date.now()];
  for (const [k, col] of map) {
    if (patch[k] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(patch[k]);
    }
  }
  db.prepare(`UPDATE businesses SET ${sets.join(', ')} WHERE id = ?`).run(...params, businessId);
  recordAudit(db, { businessId, userId, action: 'business.update', entityType: 'business', entityId: businessId, after: patch });
}
