/**
 * Cash register / shift & daily closing (§38, §39).
 *
 * A shift tracks the operator's cash desk: opening cash → movements (cash
 * sales, collections, expenses, transfers, MFS cash effects) → expected cash
 * at close vs actual counted cash. Variance (surplus/shortage) is recorded.
 */
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { type Paise } from '../../shared/money';
import { recordAudit } from './auditService';
import { allocateReference } from '../repos/sequences';
import { formatReference, REF_PREFIX } from '../../shared/refs';
import { startOfDayLocal, endOfDayLocal } from '../../shared/dates';
import { ValidationError, ConflictError, NotFoundError } from '../errors';

export function openShift(
  db: DB,
  input: { businessId: string; userId: string; openingCashPaise: Paise; note?: string; at?: number }
): { id: string; referenceNo: string } {
  const at = input.at ?? Date.now();
  const open = db
    .prepare("SELECT id FROM cash_sessions WHERE business_id = ? AND status = 'open' AND user_id = ?")
    .get(input.businessId, input.userId);
  if (open) throw new ConflictError('এই ব্যবহারকারীর একটি শিফট ইতিমধ্যে খোলা আছে।');
  if (input.openingCashPaise < 0) throw new ValidationError('প্রাথমিক নগদ ঋণাত্মক হতে পারে না।');

  const id = generateId();
  let referenceNo = '';
  tx(db, () => {
    const n = allocateReference(db, REF_PREFIX.cashSession);
    referenceNo = formatReference(REF_PREFIX.cashSession, n);
    db.prepare(
      `INSERT INTO cash_sessions
       (id, business_id, reference_no, user_id, opened_at, opening_cash_paise, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    ).run(id, input.businessId, referenceNo, input.userId, at, input.openingCashPaise, input.note ?? '', at);
    recordAudit(db, {
      businessId: input.businessId, userId: input.userId, action: 'shift.open',
      entityType: 'cash_session', entityId: id, after: { referenceNo, opening: input.openingCashPaise }, at
    });
  });
  return { id, referenceNo };
}

export function getOpenShift(db: DB, businessId: string, userId?: string) {
  return db
    .prepare(
      `SELECT cs.*, u.name AS user_name FROM cash_sessions cs
       JOIN users u ON u.id = cs.user_id
       WHERE cs.business_id = ? AND cs.status = 'open' ${userId ? 'AND cs.user_id = ?' : ''}
       ORDER BY cs.opened_at DESC LIMIT 1`
    )
    .all(businessId, ...(userId ? [userId] : [])) as Record<string, unknown>[];
}

export function getOpenShiftOne(db: DB, businessId: string, userId?: string) {
  const rows = getOpenShift(db, businessId, userId);
  return rows[0] as Record<string, unknown> | undefined;
}

/**
 * Compute expected cash for a (possibly still-open) shift window:
 * opening cash + cash inflows − cash outflows within the window.
 */
export function shiftCashSummary(
  db: DB,
  businessId: string,
  from: number,
  to: number,
  userId?: string
) {
  const uCond = userId ? 'AND t.user_id = ?' : '';
  const uParams = userId ? [userId] : [];
  // A sales refund (sale_refund) always posts a negative amount, so it can
  // only ever leave the drawer — it is listed under cash_out, never cash_in.
  const base = `
    SELECT
      COALESCE(SUM(CASE WHEN t.amount_paise > 0 AND t.transaction_type IN
        ('sale','customer_collection','transfer_in','deposit','adjustment_in','mfs_cash_in','purchase_refund')
        THEN t.amount_paise ELSE 0 END), 0) AS cash_in,
      COALESCE(SUM(CASE WHEN t.amount_paise < 0 AND t.transaction_type IN
        ('purchase_payment','expense','transfer_out','withdrawal','adjustment_out','mfs_cash_out','supplier_payment','sale_refund')
        THEN -t.amount_paise ELSE 0 END), 0) AS cash_out
    FROM account_transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.business_id = ? AND a.kind = 'cash' AND t.created_at >= ? AND t.created_at <= ? ${uCond}`;
  const row = db.prepare(base).get(
    businessId, from, to, ...(uParams as unknown[])
  ) as { cash_in: number; cash_out: number } | undefined;
  return { cashIn: row?.cash_in ?? 0, cashOut: row?.cash_out ?? 0 };
}

export interface CloseShiftInput {
  businessId: string;
  shiftId: string;
  userId: string;
  actualCashPaise: Paise;
  note?: string;
  at?: number;
}

export function closeShift(db: DB, input: CloseShiftInput) {
  const shift = db
    .prepare('SELECT * FROM cash_sessions WHERE id = ? AND business_id = ?')
    .get(input.shiftId, input.businessId) as
    | { id: string; reference_no: string; user_id: string; opened_at: number; opening_cash_paise: number; status: string }
    | undefined;
  if (!shift) throw new NotFoundError('শিফট', input.shiftId);
  if (shift.status !== 'open') throw new ConflictError('এই শিফটটি ইতিমধ্যে বন্ধ।');
  if (input.userId !== shift.user_id) {
    throw new ValidationError('শিফট যে খুলেছেন, শুধু সে-ই বন্ধ করতে পারবেন।');
  }

  const at = input.at ?? Date.now();
  const { cashIn, cashOut } = shiftCashSummary(
    db, input.businessId, shift.opened_at, at, shift.user_id
  );
  const expected = shift.opening_cash_paise + cashIn - cashOut;
  const variance = input.actualCashPaise - expected;

  tx(db, () => {
    db.prepare(
      `UPDATE cash_sessions
       SET status = 'closed', closed_at = ?, expected_cash_paise = ?, actual_cash_paise = ?, variance_paise = ?, note = ?
       WHERE id = ?`
    ).run(at, expected, input.actualCashPaise, variance, input.note ?? '', shift.id);
    recordAudit(db, {
      businessId: input.businessId, userId: input.userId, action: 'shift.close',
      entityType: 'cash_session', entityId: shift.id,
      after: { expected, actual: input.actualCashPaise, variance },
      at
    });
  });
  return { expectedCashPaise: expected, actualCashPaise: input.actualCashPaise, variancePaise: variance, cashIn, cashOut };
}

export function listShifts(
  db: DB,
  q: { businessId: string; from?: number; to?: number; limit?: number; offset?: number }
) {
  const where = ['cs.business_id = ?'];
  const params: unknown[] = [q.businessId];
  if (q.from !== undefined) { where.push('cs.opened_at >= ?'); params.push(q.from); }
  if (q.to !== undefined) { where.push('cs.opened_at <= ?'); params.push(q.to); }
  const limit = Math.min(q.limit ?? 50, 500);
  const rows = db
    .prepare(
      `SELECT cs.*, u.name AS user_name FROM cash_sessions cs
       JOIN users u ON u.id = cs.user_id
       WHERE ${where.join(' AND ')} ORDER BY cs.opened_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, q.offset ?? 0) as Record<string, unknown>[];
  return rows;
}

/** Daily closing report data (§39). */
export function dailyClosingReport(db: DB, businessId: string, at: number = Date.now()) {
  const from = startOfDayLocal(at);
  const to = endOfDayLocal(at);
  const sum = (sql: string, params: unknown[] = [businessId, from, to]) => {
    const row = db.prepare(sql).get(...params) as Record<string, number> | undefined;
    return row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) : {};
  };

  // COGS is net of returned (restocked) goods so the closing figure matches
  // the profit & loss (same domain logic as reportService.salesSummary).
  const sales = sum(`
    SELECT
      COALESCE(SUM(total_paise), 0) AS gross_sales,
      COALESCE(SUM(discount_paise), 0) AS discounts,
      COALESCE(SUM(total_paise - discount_paise + tax_paise - tax_paise), 0) AS net_base,
      COALESCE(SUM(CASE WHEN status <> 'voided' THEN total_paise ELSE 0 END), 0) AS net_sales,
      COALESCE(SUM(CASE WHEN status <> 'voided' THEN cogs_paise ELSE 0 END), 0)
        - COALESCE((SELECT SUM(cogs_paise) FROM sales_returns
                    WHERE business_id = ? AND date >= ? AND date <= ? AND status <> 'voided'), 0) AS cogs,
      COALESCE(SUM(CASE WHEN status <> 'voided' THEN due_paise ELSE 0 END), 0) AS credit_due_created,
      COALESCE(SUM(CASE WHEN status <> 'voided' THEN paid_paise ELSE 0 END), 0) AS sale_payments
    FROM sales WHERE business_id = ? AND date >= ? AND date <= ?`,
    [businessId, from, to, businessId, from, to]);

  const salesReturns = sum(`
    SELECT COALESCE(SUM(total_paise), 0) AS total FROM sales_returns
    WHERE business_id = ? AND date >= ? AND date <= ? AND status <> 'voided'`);

  const paymentsByMethod = db
    .prepare(
      `SELECT sp.payment_method, COALESCE(SUM(sp.amount_paise), 0) AS total
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
       WHERE s.business_id = ? AND s.date >= ? AND s.date <= ? AND s.status <> 'voided'
       GROUP BY sp.payment_method`
    )
    .all(businessId, from, to) as { payment_method: string; total: number }[];

  const collections = sum(`
    SELECT COALESCE(SUM(amount_paise), 0) AS total FROM customer_transactions
    WHERE business_id = ? AND transaction_type = 'payment' AND created_at >= ? AND created_at <= ?`);

  const expenses = sum(`
    SELECT COALESCE(SUM(amount_paise), 0) AS total FROM expenses
    WHERE business_id = ? AND date >= ? AND date <= ?`);

  const supplierPayments = sum(`
    SELECT COALESCE(SUM(amount_paise), 0) AS total FROM supplier_transactions
    WHERE business_id = ? AND transaction_type = 'payment' AND created_at >= ? AND created_at <= ?`);

  const purchasesDue = sum(`
    SELECT COALESCE(SUM(due_paise), 0) AS total FROM purchases
    WHERE business_id = ? AND date >= ? AND date <= ?`);

  const cashMoves = sum(`
    SELECT
      COALESCE(SUM(CASE WHEN amount_paise > 0 THEN amount_paise ELSE 0 END), 0) AS cash_in,
      COALESCE(SUM(CASE WHEN amount_paise < 0 THEN -amount_paise ELSE 0 END), 0) AS cash_out
    FROM account_transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.business_id = ? AND a.kind = 'cash' AND t.created_at >= ? AND t.created_at <= ?`);

  const mfs = sum(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type IN ('cash_in','send_money') THEN amount_paise ELSE 0 END), 0) AS cash_in,
      COALESCE(SUM(CASE WHEN transaction_type = 'cash_out' THEN amount_paise ELSE 0 END), 0) AS cash_out,
      COALESCE(SUM(commission_paise), 0) AS commission,
      COUNT(*) AS count
    FROM mfs_transactions WHERE business_id = ? AND created_at >= ? AND created_at <= ?`);

  const cashAccount = db
    .prepare("SELECT balance_paise FROM accounts WHERE business_id = ? AND kind = 'cash' AND is_active = 1 LIMIT 1")
    .get(businessId) as { balance_paise: number } | undefined;

  const netSales = (sales.net_sales ?? 0) - (salesReturns.total ?? 0);
  const grossProfit = netSales - (sales.cogs ?? 0);
  const netProfit = grossProfit - (expenses.total ?? 0);

  return {
    from,
    to,
    grossSales: sales.gross_sales ?? 0,
    discounts: sales.discounts ?? 0,
    netSales,
    cogs: sales.cogs ?? 0,
    grossProfit,
    expenses: expenses.total ?? 0,
    netProfit,
    salesByMethod: paymentsByMethod,
    customerCollections: collections.total ?? 0,
    supplierPayments: supplierPayments.total ?? 0,
    purchasesDueCreated: purchasesDue.total ?? 0,
    cashIn: cashMoves.cash_in ?? 0,
    cashOut: cashMoves.cash_out ?? 0,
    currentCashBalance: cashAccount?.balance_paise ?? 0,
    mfs
  };
}
