/**
 * Expense service (§35). Expense → account outflow + P&L.
 */
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { type Paise } from '../../shared/money';
import { recordAudit } from './auditService';
import { allocateReference } from '../repos/sequences';
import { formatReference, REF_PREFIX } from '../../shared/refs';
import { post, findAccountByMethod } from './accountService';
import { ValidationError, NotFoundError } from '../errors';

export function listExpenseCategories(db: DB, businessId: string) {
  return db
    .prepare('SELECT * FROM expense_categories WHERE business_id = ? AND is_active = 1 ORDER BY sort, name COLLATE NOCASE')
    .all(businessId) as Record<string, unknown>[];
}

export function createExpenseCategory(db: DB, businessId: string, name: string, userId?: string): string {
  if (!name?.trim()) throw new ValidationError('ক্যাটাগরির নাম দিন।');
  const exists = db
    .prepare('SELECT id FROM expense_categories WHERE business_id = ? AND name = ?')
    .get(businessId, name.trim());
  if (exists) throw new ValidationError('এই ক্যাটাগরিটি ইতিমধ্যে আছে।');
  const id = generateId();
  db.prepare(
    'INSERT INTO expense_categories (id, business_id, name, is_system, sort, is_active, created_at) VALUES (?, ?, ?, 0, 0, 1, ?)'
  ).run(id, businessId, name.trim(), Date.now());
  recordAudit(db, { businessId, userId, action: 'expense_category.create', entityType: 'expense_category', entityId: id, after: { name } });
  return id;
}

export interface CreateExpenseInput {
  businessId: string;
  userId: string;
  categoryId: string;
  amountPaise: Paise;
  method?: string;
  reference?: string;
  note?: string;
  date?: number;
  at?: number;
}

export function createExpense(db: DB, input: CreateExpenseInput): { id: string; referenceNo: string } {
  if (input.amountPaise <= 0) throw new ValidationError('খরচের অর্থ সঠিক নয়।');
  const cat = db
    .prepare('SELECT * FROM expense_categories WHERE id = ? AND business_id = ? AND is_active = 1')
    .get(input.categoryId, input.businessId) as Record<string, unknown> | undefined;
  if (!cat) throw new NotFoundError('খরচ ক্যাটাগরি', input.categoryId);

  const method = input.method ?? 'cash';
  const accountId = findAccountByMethod(db, input.businessId, method);
  if (!accountId) throw new ValidationError(`“${method}”-এর জন্য কোনো সক্রিয় হিসাব নেই।`);

  const id = generateId();
  let referenceNo = '';
  const at = input.at ?? Date.now();
  tx(db, () => {
    const n = allocateReference(db, REF_PREFIX.expense);
    referenceNo = formatReference(REF_PREFIX.expense, n);
    db.prepare(
      `INSERT INTO expenses
       (id, business_id, category_id, reference_no, date, amount_paise, payment_method, account_id,
        reference, note, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.businessId, cat.id, referenceNo, input.date ?? at, input.amountPaise, method, accountId, input.reference ?? '', input.note ?? '', input.userId, at, at);
    post(db, {
      businessId: input.businessId,
      accountId,
      type: 'expense',
      amountPaise: -input.amountPaise,
      referenceType: 'expense',
      referenceId: id,
      referenceNo,
      note: `খরচ (${cat.name as string})`,
      userId: input.userId,
      at
    });
    recordAudit(db, {
      businessId: input.businessId, userId: input.userId, action: 'expense.create',
      entityType: 'expense', entityId: id, after: { amount: input.amountPaise, category: cat.name, referenceNo }
    });
  });
  return { id, referenceNo };
}

export function listExpenses(
  db: DB,
  q: { businessId: string; from?: number; to?: number; categoryId?: string; limit?: number; offset?: number; search?: string }
) {
  const where = ['e.business_id = ?'];
  const params: unknown[] = [q.businessId];
  if (q.from !== undefined) { where.push('e.date >= ?'); params.push(q.from); }
  if (q.to !== undefined) { where.push('e.date <= ?'); params.push(q.to); }
  if (q.categoryId) { where.push('e.category_id = ?'); params.push(q.categoryId); }
  if (q.search) { where.push('(e.reference_no LIKE ? OR e.note LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`); }
  const limit = Math.min(q.limit ?? 50, 500);
  const rows = db
    .prepare(
      `SELECT e.*, c.name AS category_name, a.name AS account_name, u.name AS user_name
       FROM expenses e
       JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN accounts a ON a.id = e.account_id
       LEFT JOIN users u ON u.id = e.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY e.date DESC, e.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, q.offset ?? 0) as Record<string, unknown>[];
  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM expenses e WHERE ${where.join(' AND ')}`
    )
    .get(...params) as { c: number };
  return { rows, total: total.c };
}

export function getExpense(db: DB, businessId: string, id: string) {
  return db
    .prepare(
      `SELECT e.*, c.name AS category_name, a.name AS account_name, u.name AS user_name
       FROM expenses e
       JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN accounts a ON a.id = e.account_id
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.id = ? AND e.business_id = ?`
    )
    .get(id, businessId) as Record<string, unknown> | undefined;
}
