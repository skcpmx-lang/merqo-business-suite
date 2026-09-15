/**
 * Account service — THE single funnel for money movement (§119, §36, §37).
 *
 * Every module (sales, purchases, expenses, payments, MFS, transfers) moves
 * money by posting through `post()`. Balances are denormalized on `accounts`
 * and always reconcilable against the ledger (account_transactions).
 *
 *  - Internal transfers are never revenue: they post transfer_out/transfer_in.
 *  - Negative balances are blocked unless explicitly configured.
 *  - Cheques post to their account only when marked cleared (configurable).
 */
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { getSetting, getFinancialSettings } from '../repos/settings';
import { allocateReference } from '../repos/sequences';
import {
  NotFoundError, InvalidStateError, InsufficientFundsError, ValidationError
} from '../errors';
import { REF_PREFIX } from '../../shared/refs';

export type AccountTransactionType =
  | 'opening'
  | 'sale'
  | 'sale_refund'
  | 'purchase_payment'
  | 'purchase_refund'
  | 'customer_collection'
  | 'customer_refund'
  | 'supplier_payment'
  | 'supplier_refund'
  | 'expense'
  | 'transfer_in'
  | 'transfer_out'
  | 'deposit'
  | 'withdrawal'
  | 'adjustment_in'
  | 'adjustment_out'
  | 'mfs_cash_in'
  | 'mfs_cash_out';

export interface PostInput {
  businessId: string;
  accountId: string;
  type: AccountTransactionType;
  /** Signed delta in paise (+ credit the account, − debit). */
  amountPaise: number;
  referenceType?: string;
  referenceId?: string;
  referenceNo?: string;
  note?: string;
  userId?: string | null;
  at?: number;
}

export function getAccount(db: DB, businessId: string, accountId: string) {
  const row = db
    .prepare('SELECT * FROM accounts WHERE id = ? AND business_id = ?')
    .get(accountId, businessId) as {
      id: string; name: string; kind: string; balance_paise: number; is_active: number;
      mfs_provider: string | null;
    } | undefined;
  if (!row) throw new NotFoundError('হিসাব', accountId);
  return row;
}

export function listAccounts(db: DB, businessId: string, includeInactive = false) {
  return db
    .prepare(
      `SELECT * FROM accounts WHERE business_id = ? ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY sort ASC, name COLLATE NOCASE ASC`
    )
    .all(businessId) as Record<string, unknown>[];
}

/**
 * Resolve the business account that a payment method posts to.
 *  - cash → the cash account (kind=cash, e.g. নগদ)
 *  - bank / cheque → the bank account (cheques settle into the bank account)
 *  - bkash/nagad/rocket/upay/other → account by mfs_provider/name (kind=mfs/other)
 */
export function findAccountByMethod(db: DB, businessId: string, method: string): string | null {
  let row: { id: string } | undefined;
  if (method === 'cash') {
    row = db
      .prepare("SELECT id FROM accounts WHERE business_id = ? AND is_active = 1 AND kind = 'cash' ORDER BY is_system DESC LIMIT 1")
      .get(businessId) as { id: string } | undefined;
  } else if (method === 'bank' || method === 'cheque') {
    row = db
      .prepare("SELECT id FROM accounts WHERE business_id = ? AND is_active = 1 AND kind = 'bank' ORDER BY is_system DESC LIMIT 1")
      .get(businessId) as { id: string } | undefined;
  } else if (method === 'other') {
    row = db
      .prepare("SELECT id FROM accounts WHERE business_id = ? AND is_active = 1 AND kind = 'other' ORDER BY is_system DESC LIMIT 1")
      .get(businessId) as { id: string } | undefined;
  } else {
    row = db
      .prepare(
        'SELECT id FROM accounts WHERE business_id = ? AND is_active = 1 AND (mfs_provider = ? OR LOWER(name) = ?) ORDER BY is_system DESC LIMIT 1'
      )
      .get(businessId, method, method.toLowerCase()) as { id: string } | undefined;
  }
  return row?.id ?? null;
}

/**
 * Post a signed delta to an account and record the ledger row.
 * MUST run inside the caller's transaction.
 */
export function post(db: DB, input: PostInput): void {
  const account = getAccount(db, input.businessId, input.accountId);
  if (!account.is_active) {
    throw new InvalidStateError(`“${account.name}” হিসাবটি নিষ্ক্রিয়।`);
  }
  if (input.amountPaise === 0) return;

  const newBalance = account.balance_paise + input.amountPaise;
  if (newBalance < 0 && !getFinancialSettings(db, input.businessId).allow_negative_accounts) {
    throw new InsufficientFundsError(account.name, account.balance_paise, -input.amountPaise);
  }

  const id = generateId();
  const at = input.at ?? Date.now();
  db.prepare(
    `INSERT INTO account_transactions
     (id, business_id, account_id, transaction_type, amount_paise, balance_after_paise,
      reference_type, reference_id, reference_no, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, input.businessId, account.id, input.type, input.amountPaise, newBalance,
    input.referenceType ?? null, input.referenceId ?? null, input.referenceNo ?? null,
    input.note ?? '', input.userId ?? null, at
  );
  db.prepare('UPDATE accounts SET balance_paise = ? WHERE id = ?').run(newBalance, account.id);
}

export interface TransferInput {
  businessId: string;
  fromAccountId: string;
  toAccountId: string;
  amountPaise: number;
  note?: string;
  userId?: string | null;
  at?: number;
}

/**
 * Internal transfer (Cash → Bank): debits source, credits destination, and
 * keeps a linked record. Never revenue, never expense (§37).
 */
export function transfer(db: DB, input: TransferInput): { id: string; referenceNo: string } {
  if (input.amountPaise <= 0) throw new ValidationError('ট্রান্সফারের পরিমাণ সঠিক নয়।');
  if (input.fromAccountId === input.toAccountId) {
    throw new ValidationError('একই হিসাবের মধ্যে ট্রান্সফার করা যায় না।');
  }
  const from = getAccount(db, input.businessId, input.fromAccountId);
  const to = getAccount(db, input.businessId, input.toAccountId);

  const id = generateId();
  const at = input.at ?? Date.now();

  // Atomic: the transfer record + both postings commit or roll back together.
  let referenceNo = '';
  tx(db, () => {
    const n = allocateReference(db, REF_PREFIX.accountTransfer);
    referenceNo = `${REF_PREFIX.accountTransfer}-${String(n).padStart(6, '0')}`;

    db.prepare(
      `INSERT INTO account_transfers
       (id, business_id, reference_no, from_account_id, to_account_id, amount_paise, note, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.businessId, referenceNo, from.id, to.id, input.amountPaise, input.note ?? '', input.userId ?? null, at);

    post(db, {
      businessId: input.businessId, accountId: from.id, type: 'transfer_out',
      amountPaise: -input.amountPaise, referenceType: 'account_transfer', referenceId: id,
      referenceNo, note: `→ ${to.name}${input.note ? ' — ' + input.note : ''}`, userId: input.userId, at
    });
    post(db, {
      businessId: input.businessId, accountId: to.id, type: 'transfer_in',
      amountPaise: input.amountPaise, referenceType: 'account_transfer', referenceId: id,
      referenceNo, note: `← ${from.name}${input.note ? ' — ' + input.note : ''}`, userId: input.userId, at
    });
  });
  return { id, referenceNo };
}

export function accountTransactions(
  db: DB,
  businessId: string,
  accountId?: string,
  opts?: { from?: number; to?: number; limit?: number; offset?: number }
) {
  const where = ['t.business_id = ?'];
  const params: unknown[] = [businessId];
  if (accountId) {
    where.push('t.account_id = ?');
    params.push(accountId);
  }
  if (opts?.from !== undefined) {
    where.push('t.created_at >= ?');
    params.push(opts.from);
  }
  if (opts?.to !== undefined) {
    where.push('t.created_at <= ?');
    params.push(opts.to);
  }
  const limit = Math.min(opts?.limit ?? 200, 1000);
  const rows = db
    .prepare(
      `SELECT t.*, a.name AS account_name FROM account_transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, opts?.offset ?? 0) as Record<string, unknown>[];
  return rows;
}

/**
 * Recompute a balance from the ledger — used for reconciliation checks.
 * The ledger includes the opening-balance row, so the sum is the full balance.
 */
export function recomputedBalance(db: DB, accountId: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount_paise), 0) AS s FROM account_transactions WHERE account_id = ?')
    .get(accountId) as { s: number };
  return row.s;
}
