/**
 * Customer service (§21, §34): CRUD, credit collections, ledger.
 */
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { type Paise } from '../../shared/money';
import { recordAudit } from './auditService';
import { allocateReference } from '../repos/sequences';
import { formatReference, REF_PREFIX } from '../../shared/refs';
import { post, findAccountByMethod } from './accountService';
import { postCustomerLedger } from './saleService';
import { ValidationError, NotFoundError, ConflictError } from '../errors';

export interface CustomerInput {
  businessId: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  customerType?: string;
  creditLimitPaise?: number;
  openingDuePaise?: number;
  notes?: string;
  userId?: string | null;
  at?: number;
}

export function createCustomer(db: DB, input: CustomerInput): string {
  if (!input.name?.trim()) throw new ValidationError('কাস্টমারের নাম দিন।');
  const id = generateId();
  const at = input.at ?? Date.now();
  const opening = input.openingDuePaise ?? 0;
  if (opening < 0) throw new ValidationError('প্রারম্ভিক বকেয়া ঋণাত্মক হতে পারে না।');
  tx(db, () => {
    db.prepare(
      `INSERT INTO customers (id, business_id, name, phone, email, address, customer_type,
                              credit_limit_paise, opening_due_paise, due_balance_paise, notes,
                              is_active, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      id, input.businessId, input.name.trim(), input.phone ?? '', input.email ?? '',
      input.address ?? '', input.customerType ?? 'retail', input.creditLimitPaise ?? 0,
      opening, opening, input.notes ?? '', at, at, input.userId ?? null
    );
    if (opening > 0) {
      db.prepare(
        `INSERT INTO customer_transactions
         (id, business_id, customer_id, transaction_type, amount_paise, note, user_id, created_at)
         VALUES (?, ?, ?, 'opening', ?, 'প্রারম্ভিক বকেয়া', ?, ?)`
      ).run(generateId(), input.businessId, id, opening, input.userId ?? null, at);
    }
    recordAudit(db, { businessId: input.businessId, userId: input.userId, action: 'customer.create', entityType: 'customer', entityId: id, after: { name: input.name } });
  });
  return id;
}

export function updateCustomer(
  db: DB,
  id: string,
  patch: Partial<Omit<CustomerInput, 'businessId' | 'openingDuePaise'>>,
  userId?: string
): void {
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) throw new NotFoundError('কাস্টমার', id);
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [Date.now()];
  const map: [string, string][] = [
    ['name', 'name'], ['phone', 'phone'], ['email', 'email'], ['address', 'address'],
    ['customerType', 'customer_type'], ['creditLimitPaise', 'credit_limit_paise'], ['notes', 'notes']
  ];
  for (const [k, col] of map) {
    if (patch[k as keyof typeof patch] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(patch[k as keyof typeof patch]);
    }
  }
  if ('isActive' in patch) sets.push('is_active = ?'), params.push(patch.isActive ? 1 : 0);
  if (existing.due_balance_paise !== 0) {
    throw new ConflictError('বকেয়া থাকা কাস্টমারের প্রোফাইল সম্পাদনায় সতর্ক থাকুন।');
  }
  db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  recordAudit(db, { businessId: (existing.business_id as string), userId, action: 'customer.update', entityType: 'customer', entityId: id });
}

export function listCustomers(
  db: DB,
  q: { businessId: string; search?: string; limit?: number; offset?: number; onlyWithDue?: boolean }
) {
  const where = ['c.business_id = ?', 'c.is_active = 1'];
  const params: unknown[] = [q.businessId];
  if (q.search) {
    where.push('(c.name LIKE ? OR c.phone LIKE ?)');
    params.push(`%${q.search}%`, `%${q.search}%`);
  }
  if (q.onlyWithDue) where.push('c.due_balance_paise > 0');
  const limit = Math.min(q.limit ?? 50, 500);
  const rows = db
    .prepare(
      `SELECT c.*,
              COALESCE((SELECT SUM(amount_paise) FROM customer_transactions ct WHERE ct.customer_id = c.id AND ct.transaction_type IN ('sale','opening') ), 0) AS total_sales_paise,
              COALESCE((SELECT SUM(amount_paise) FROM customer_transactions ct WHERE ct.customer_id = c.id AND ct.transaction_type = 'payment'), 0) AS total_paid_paise,
              (SELECT created_at FROM customer_transactions ct WHERE ct.customer_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_txn_at
       FROM customers c WHERE ${where.join(' AND ')}
       ORDER BY c.name COLLATE NOCASE ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, q.offset ?? 0) as Record<string, unknown>[];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM customers c WHERE ${where.join(' AND ')}`).get(...params) as { c: number };
  return { rows, total: total.c };
}

export function getCustomer(db: DB, id: string) {
  const row = db
    .prepare(
      `SELECT c.*,
              COALESCE((SELECT SUM(amount_paise) FROM customer_transactions ct WHERE ct.customer_id = c.id AND ct.transaction_type IN ('sale','opening')), 0) AS total_sales_paise,
              COALESCE((SELECT SUM(amount_paise) FROM customer_transactions ct WHERE ct.customer_id = c.id AND ct.transaction_type = 'payment'), 0) AS total_paid_paise,
              (SELECT created_at FROM customer_transactions ct WHERE ct.customer_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_txn_at
       FROM customers c WHERE c.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return row;
}

export function customerLedger(db: DB, customerId: string, from?: number, to?: number, limit = 300) {
  return db
    .prepare(
      `SELECT t.*, u.name AS user_name
       FROM customer_transactions t LEFT JOIN users u ON u.id = t.user_id
       WHERE t.customer_id = ? ${from !== undefined ? 'AND t.created_at >= ?' : ''} ${to !== undefined ? 'AND t.created_at <= ?' : ''}
       ORDER BY t.created_at DESC, t.id DESC LIMIT ?`
    )
    .all(customerId, ...(from !== undefined ? [from] : []), ...(to !== undefined ? [to] : []), limit) as Record<string, unknown>[];
}

export interface CollectPaymentInput {
  businessId: string;
  userId: string;
  customerId: string;
  amountPaise: Paise;
  method: string;
  reference?: string;
  note?: string;
  at?: number;
}

/** Collect an old due from a customer (§21). Money → account; due decreases. */
export function collectCustomerPayment(db: DB, input: CollectPaymentInput): { id: string; referenceNo: string; amountPaise: Paise } {
  if (input.amountPaise <= 0) throw new ValidationError('পেমেন্টের অর্থ সঠিক নয়।');
  const cust = db
    .prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?')
    .get(input.customerId, input.businessId) as { id: string; name: string; due_balance_paise: number } | undefined;
  if (!cust) throw new NotFoundError('কাস্টমার', input.customerId);
  if (input.amountPaise > cust.due_balance_paise) {
    throw new ValidationError('বকেয়ার চেয়ে বেশি পেমেন্ট গ্রহণ করা যায় না।');
  }
  const accountId = findAccountByMethod(db, input.businessId, input.method);
  if (!accountId) throw new ValidationError(`“${input.method}”-এর জন্য কোনো সক্রিয় হিসাব নেই।`);

  const id = generateId();
  let referenceNo = '';
  tx(db, () => {
    const n = allocateReference(db, REF_PREFIX.customerPayment);
    referenceNo = formatReference(REF_PREFIX.customerPayment, n);
    post(db, {
      businessId: input.businessId,
      accountId,
      type: 'customer_collection',
      amountPaise: input.amountPaise,
      referenceType: 'customer_payment',
      referenceId: id,
      referenceNo,
      note: `কাস্টমার পেমেন্ট — ${cust.name}`,
      userId: input.userId,
      at: input.at
    });
    postCustomerLedger(db, input.businessId, cust.id, {
      type: 'payment',
      amountPaise: input.amountPaise,
      referenceType: 'customer_payment',
      referenceId: id,
      referenceNo,
      paymentMethod: input.method,
      note: input.note ?? `বকেয়া আদায় (${cust.name})`,
      userId: input.userId,
      at: input.at
    });
    recordAudit(db, {
      businessId: input.businessId, userId: input.userId, action: 'customer.payment',
      entityType: 'customer', entityId: cust.id, after: { amount: input.amountPaise, referenceNo }
    });
  });
  return { id, referenceNo, amountPaise: input.amountPaise };
}
