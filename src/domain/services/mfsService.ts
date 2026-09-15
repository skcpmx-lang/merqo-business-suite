/**
 * MFS Agent service (§40–§43).
 *
 * This records MANUAL mobile-financial-service agent transactions — there is
 * NO live provider API integration (offline-first, no paid API, §152).
 *
 * Concepts kept strictly separate (§118):
 *  - business MFS payment accounts (bKash/Nagad as payment instruments)
 *  - MFS agent wallets (the agent's float for customer cash-in/cash-out)
 *
 * Commission rates are configurable rules (§42) — never invented defaults.
 */
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { type Paise, percentPaise } from '../../shared/money';
import { recordAudit } from './auditService';
import { allocateReference } from '../repos/sequences';
import { formatReference, REF_PREFIX } from '../../shared/refs';
import { post, findAccountByMethod, listAccounts } from './accountService';
import { ValidationError, NotFoundError } from '../errors';

export const MFS_TRANSACTION_TYPES = [
  { key: 'cash_in', label: 'ক্যাশ-ইন (মোবাইল অ্যাকাউন্টে ডিপোজিট)' },
  { key: 'cash_out', label: 'ক্যাশ-আউট (নগদ প্রদান)' },
  { key: 'send_money', label: 'সেন্ড মানি (কাস্টমার পেমেন্ট)' },
  { key: 'other', label: 'অন্যান্য' }
] as const;

export type MfsTransactionType = (typeof MFS_TRANSACTION_TYPES)[number]['key'];

/** Types that move cash between the shop and the agent wallet. */
const CASH_IN_TYPES = new Set<MfsTransactionType>(['cash_in', 'send_money']);
const CASH_OUT_TYPES = new Set<MfsTransactionType>(['cash_out']);

export function listProviders(db: DB, businessId: string) {
  return db
    .prepare(
      `SELECT p.*, w.account_no AS wallet_account_no, w.balance_paise AS wallet_balance_paise,
              w.opening_balance_paise AS wallet_opening_paise
       FROM mfs_providers p
       LEFT JOIN mfs_wallets w ON w.provider_id = p.id AND w.business_id = p.business_id
       WHERE p.business_id = ? AND p.is_active = 1
       ORDER BY p.sort ASC`
    )
    .all(businessId) as Record<string, unknown>[];
}

export function getProvider(db: DB, businessId: string, providerId: string) {
  const row = db
    .prepare(
      `SELECT p.*, w.id AS wallet_id, w.account_no AS wallet_account_no,
              w.balance_paise AS wallet_balance_paise
       FROM mfs_providers p LEFT JOIN mfs_wallets w ON w.provider_id = p.id
       WHERE p.id = ? AND p.business_id = ?`
    )
    .get(providerId, businessId) as
    | { id: string; key: string; name: string; wallet_id: string | null; wallet_balance_paise: number | null }
    | undefined;
  if (!row) throw new NotFoundError('MFS প্রভাইডার', providerId);
  return row;
}

/** Set/update an agent wallet (account number, opening balance). */
export function setupWallet(
  db: DB,
  input: { businessId: string; userId: string; providerId: string; accountNo?: string; openingBalancePaise?: Paise }
): void {
  const provider = getProvider(db, input.businessId, input.providerId);
  if (!provider.wallet_id) throw invalidStateNoWallet(provider.name);

  // Atomic: the wallet opening-balance adjustment + audit row commit
  // together or not at all.
  tx(db, () => {
    if (input.openingBalancePaise !== undefined) {
      const current = provider.wallet_balance_paise ?? 0;
      const delta = input.openingBalancePaise - current;
      if (delta !== 0) {
        db.prepare('UPDATE mfs_wallets SET opening_balance_paise = opening_balance_paise + ? WHERE id = ?')
          .run(delta, provider.wallet_id);
        db.prepare(
          `INSERT INTO mfs_transactions
           (id, business_id, reference_no, provider_id, wallet_id, transaction_type, amount_paise,
            commission_paise, note, operator, status, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'other', 0, 0, 'প্রাথমিক ব্যালেন্স সমন্বয়', '', 'completed', ?, ?)`
        ).run(
          generateId(), input.businessId, `MFS-OPEN-${generateId().slice(0, 8)}`,
          provider.id, provider.wallet_id, input.userId, Date.now()
        );
        db.prepare('UPDATE mfs_wallets SET balance_paise = ? WHERE id = ?')
          .run(input.openingBalancePaise, provider.wallet_id);
      }
    }
    if (input.accountNo !== undefined) {
      db.prepare('UPDATE mfs_wallets SET account_no = ? WHERE id = ?').run(input.accountNo, provider.wallet_id);
    }
    recordAudit(db, {
      businessId: input.businessId, userId: input.userId, action: 'mfs.wallet_setup',
      entityType: 'mfs_provider', entityId: provider.id,
      after: { accountNo: input.accountNo ?? null, openingBalance: input.openingBalancePaise ?? null }
    });
  });
}

function invalidStateNoWallet(name: string): ValidationError {
  return new ValidationError(`“${name}”-এর জন্য এজেন্ট ওয়ালেট নেই।`);
}

export interface CreateMfsTransactionInput {
  businessId: string;
  userId: string;
  providerId: string;
  transactionType: MfsTransactionType;
  amountPaise: Paise;
  customerName?: string;
  customerPhone?: string;
  txnRef?: string;
  /** explicit commission override; otherwise computed from rules */
  commissionPaise?: Paise;
  /** business account the cash moves to/from (default: cash account) */
  accountMethod?: string;
  note?: string;
  operator?: string;
  at?: number;
}

export function computeCommission(
  db: DB,
  businessId: string,
  providerId: string,
  type: MfsTransactionType,
  amountPaise: Paise
): Paise {
  const rule = db
    .prepare(
      'SELECT * FROM mfs_commission_rules WHERE business_id = ? AND provider_id = ? AND transaction_type = ? AND is_active = 1'
    )
    .get(businessId, providerId, type) as
    | { rate_bps: number; fixed_amount_paise: number; min_paise: number; max_paise: number }
    | undefined;
  if (!rule) return 0;
  let commission: Paise;
  if (rule.rate_bps > 0) commission = percentPaise(amountPaise, rule.rate_bps);
  else commission = rule.fixed_amount_paise;
  if (rule.min_paise > 0 && commission < rule.min_paise) commission = rule.min_paise;
  if (rule.max_paise > 0 && commission > rule.max_paise) commission = rule.max_paise;
  return commission;
}

export function saveCommissionRule(
  db: DB,
  input: {
    businessId: string;
    userId: string;
    providerId: string;
    transactionType: MfsTransactionType;
    rateBps?: number;
    fixedAmountPaise?: Paise;
    minPaise?: number;
    maxPaise?: number;
    isActive?: boolean;
  }
): void {
  const provider = getProvider(db, input.businessId, input.providerId);
  const id = generateId();
  db.prepare(
    `INSERT INTO mfs_commission_rules
     (id, business_id, provider_id, transaction_type, rate_bps, fixed_amount_paise, min_paise, max_paise, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (business_id, provider_id, transaction_type)
     DO UPDATE SET rate_bps = excluded.rate_bps, fixed_amount_paise = excluded.fixed_amount_paise,
       min_paise = excluded.min_paise, max_paise = excluded.max_paise, is_active = excluded.is_active`
  ).run(
    id, input.businessId, provider.id, input.transactionType,
    input.rateBps ?? 0, input.fixedAmountPaise ?? 0, input.minPaise ?? 0, input.maxPaise ?? 0,
    input.isActive === false ? 0 : 1, Date.now()
  );
  recordAudit(db, {
    businessId: input.businessId, userId: input.userId, action: 'mfs.commission_rule',
    entityType: 'mfs_provider', entityId: provider.id,
    after: { type: input.transactionType, rateBps: input.rateBps ?? 0, fixed: input.fixedAmountPaise ?? 0 }
  });
}

export function listCommissionRules(db: DB, businessId: string) {
  return db
    .prepare(
      `SELECT r.*, p.name AS provider_name FROM mfs_commission_rules r
       JOIN mfs_providers p ON p.id = r.provider_id
       WHERE r.business_id = ? ORDER BY p.sort, r.transaction_type`
    )
    .all(businessId) as Record<string, unknown>[];
}

export function createMfsTransaction(db: DB, input: CreateMfsTransactionInput) {
  const provider = getProvider(db, input.businessId, input.providerId);
  if (!provider.wallet_id) throw invalidStateNoWallet(provider.name);
  if (input.amountPaise <= 0) throw new ValidationError('লেনদেনের অর্থ সঠিক নয়।');

  const commission = input.commissionPaise ?? computeCommission(
    db, input.businessId, provider.id, input.transactionType, input.amountPaise
  );
  if (commission < 0) throw new ValidationError('কমিশন ঋণাত্মক হতে পারে না।');

  const accountMethod = input.accountMethod ?? 'cash';
  const accountId = findAccountByMethod(db, input.businessId, accountMethod);
  if (!accountId) throw new ValidationError(`“${accountMethod}”-এর জন্য কোনো সক্রিয় হিসাব নেই।`);

  const id = generateId();
  let referenceNo = '';
  const at = input.at ?? Date.now();

  tx(db, () => {
    const n = allocateReference(db, REF_PREFIX.mfs);
    referenceNo = formatReference(REF_PREFIX.mfs, n);

    const wallet = db
      .prepare('SELECT * FROM mfs_wallets WHERE id = ?')
      .get(provider.wallet_id!) as { id: string; balance_paise: number };

    // Wallet movement:
    //  cash_in: customer puts money INTO mobile account → wallet balance +
    //  cash_out: customer withdraws from mobile account → wallet balance −
    //  send_money: customer hands cash and the transfer is processed; the cash
    //    settles into the agent float → wallet balance + (mirrors cash_in)
    let walletDelta = 0;
    if (CASH_IN_TYPES.has(input.transactionType)) walletDelta = input.amountPaise;
    else walletDelta = -input.amountPaise;

    const newWallet = wallet.balance_paise + walletDelta;
    if (newWallet < 0) {
      throw new ValidationError('এজেন্ট ওয়ালেটের ব্যালেন্সে এই লেনদেন সম্ভব নয় (পর্যাপ্ত ব্যালেন্স নেই)।');
    }

    // Shop cash effect:
    //  cash_in: shop receives cash from customer (to deposit) → cash +
    //  send_money: customer hands cash, agent processes the transfer; the cash
    //    settles into the agent float → cash + (wallet +)
    //  cash_out: shop pays cash to customer → cash − (wallet −)
    let cashDelta = 0;
    let cashTxType: 'mfs_cash_in' | 'mfs_cash_out' | null = null;
    if (input.transactionType === 'cash_in' || input.transactionType === 'send_money') {
      cashDelta = input.amountPaise;
      cashTxType = 'mfs_cash_in';
    } else if (input.transactionType === 'cash_out') {
      cashDelta = -input.amountPaise;
      cashTxType = 'mfs_cash_out';
    }

    db.prepare(
      `INSERT INTO mfs_transactions
       (id, business_id, reference_no, provider_id, wallet_id, transaction_type, amount_paise,
        customer_name, customer_phone, txn_ref, commission_paise, account_id, note, operator,
        status, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`
    ).run(
      id, input.businessId, referenceNo, provider.id, provider.wallet_id, input.transactionType,
      input.amountPaise, input.customerName ?? '', input.customerPhone ?? '', input.txnRef ?? '',
      commission, accountId, input.note ?? '', input.operator ?? '', input.userId, at
    );

    db.prepare('UPDATE mfs_wallets SET balance_paise = ? WHERE id = ?').run(newWallet, provider.wallet_id);

    if (cashTxType && cashDelta !== 0) {
      post(db, {
        businessId: input.businessId,
        accountId,
        type: cashTxType,
        amountPaise: cashDelta,
        referenceType: 'mfs_transaction',
        referenceId: id,
        referenceNo,
        note: `MFS ${provider.name} — ${MFS_TRANSACTION_TYPES.find((t) => t.key === input.transactionType)?.label}`,
        userId: input.userId,
        at
      });
    }

    recordAudit(db, {
      businessId: input.businessId, userId: input.userId, action: 'mfs.transaction',
      entityType: 'mfs_transaction', entityId: id,
      after: { provider: provider.key, type: input.transactionType, amount: input.amountPaise, commission },
      at
    });
  });

  return { id, referenceNo, commissionPaise: commission };
}

export function queryMfsTransactions(
  db: DB,
  q: { businessId: string; providerId?: string; from?: number; to?: number; limit?: number; offset?: number }
) {
  const where = ['t.business_id = ?'];
  const params: unknown[] = [q.businessId];
  if (q.providerId) { where.push('t.provider_id = ?'); params.push(q.providerId); }
  if (q.from !== undefined) { where.push('t.created_at >= ?'); params.push(q.from); }
  if (q.to !== undefined) { where.push('t.created_at <= ?'); params.push(q.to); }
  const limit = Math.min(q.limit ?? 50, 500);
  const rows = db
    .prepare(
      `SELECT t.*, p.name AS provider_name, p.key AS provider_key, u.name AS user_name, a.name AS account_name
       FROM mfs_transactions t
       JOIN mfs_providers p ON p.id = t.provider_id
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN accounts a ON a.id = t.account_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, q.offset ?? 0) as Record<string, unknown>[];
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM mfs_transactions t WHERE ${where.join(' AND ')}`)
    .get(...params) as { c: number };
  return { rows, total: total.c };
}

/** MFS reconciliation for a provider (§43). */
export function mfsReconciliation(db: DB, businessId: string, providerId: string, from?: number, to?: number) {
  const provider = getProvider(db, businessId, providerId);
  const cond = from !== undefined ? 'AND t.created_at >= ?' : '';
  const cond2 = to !== undefined ? 'AND t.created_at <= ?' : '';
  const params: unknown[] = [businessId, providerId, ...(from !== undefined ? [from] : []), ...(to !== undefined ? [to] : [])];
  const agg = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN t.transaction_type IN ('cash_in','send_money') THEN t.amount_paise ELSE 0 END), 0) AS cash_in,
         COALESCE(SUM(CASE WHEN t.transaction_type = 'cash_out' THEN t.amount_paise ELSE 0 END), 0) AS cash_out,
         COALESCE(SUM(t.commission_paise), 0) AS commission,
         COUNT(*) AS count
       FROM mfs_transactions t
       WHERE t.business_id = ? AND t.provider_id = ? ${cond} ${cond2}`
    )
    .get(...params) as { cash_in: number; cash_out: number; commission: number; count: number };
  const wallet = db.prepare('SELECT opening_balance_paise, balance_paise FROM mfs_wallets WHERE provider_id = ? AND business_id = ?').get(providerId, businessId) as
    { opening_balance_paise: number; balance_paise: number };
  return {
    providerName: provider.name,
    openingBalancePaise: wallet.opening_balance_paise,
    cashInPaise: agg.cash_in,
    cashOutPaise: agg.cash_out,
    commissionPaise: agg.commission,
    expectedBalancePaise: wallet.opening_balance_paise + agg.cash_in - agg.cash_out,
    walletBalancePaise: wallet.balance_paise,
    variancePaise: wallet.balance_paise - (wallet.opening_balance_paise + agg.cash_in - agg.cash_out),
    transactionCount: agg.count
  };
}

export function mfsSummary(db: DB, businessId: string, from?: number, to?: number) {
  const cond = from !== undefined ? 'AND t.created_at >= ?' : '';
  const cond2 = to !== undefined ? 'AND t.created_at <= ?' : '';
  const params: unknown[] = [businessId, ...(from !== undefined ? [from] : []), ...(to !== undefined ? [to] : [])];
  const rows = db
    .prepare(
      `SELECT t.provider_id, p.name AS provider_name,
              COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN t.transaction_type IN ('cash_in','send_money') THEN t.amount_paise ELSE 0 END), 0) AS cash_in,
              COALESCE(SUM(CASE WHEN t.transaction_type = 'cash_out' THEN t.amount_paise ELSE 0 END), 0) AS cash_out,
              COALESCE(SUM(t.commission_paise), 0) AS commission
       FROM mfs_transactions t JOIN mfs_providers p ON p.id = t.provider_id
       WHERE t.business_id = ? ${cond} ${cond2}
       GROUP BY t.provider_id ORDER BY p.sort`
    )
    .all(...params) as Record<string, unknown>[];
  return rows;
}

export { listAccounts };
