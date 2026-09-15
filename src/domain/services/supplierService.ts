/**
 * Supplier service (§31, §32): CRUD and supplier payments.
 */
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { type Paise } from '../../shared/money';
import { recordAudit } from './auditService';
import { allocateReference } from '../repos/sequences';
import { formatReference, REF_PREFIX } from '../../shared/refs';
import { post, findAccountByMethod } from './accountService';
import { postSupplierLedger } from './purchaseService';
import { ValidationError, NotFoundError, ConflictError } from '../errors';

export interface SupplierInput {
  businessId: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  address?: string;
  contactPerson?: string;
  openingPayablePaise?: number;
  paymentTerms?: string;
  notes?: string;
  userId?: string | null;
  at?: number;
}

export function createSupplier(db: DB, input: SupplierInput): string {
  if (!input.name?.trim()) throw new ValidationError('সাপ্লায়ারের নাম দিন।');
  const id = generateId();
  const at = input.at ?? Date.now();
  const opening = input.openingPayablePaise ?? 0;
  if (opening < 0) throw new ValidationError('প্রারম্ভিক প্রদেয় ঋণাত্মক হতে পারে না।');
  tx(db, () => {
    db.prepare(
      `INSERT INTO suppliers (id, business_id, name, company, phone, email, address, contact_person,
                              opening_payable_paise, payable_balance_paise, payment_terms, notes,
                              is_active, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      id, input.businessId, input.name.trim(), input.company ?? '', input.phone ?? '',
      input.email ?? '', input.address ?? '', input.contactPerson ?? '', opening, opening,
      input.paymentTerms ?? '', input.notes ?? '', at, at, input.userId ?? null
    );
    if (opening > 0) {
      db.prepare(
        `INSERT INTO supplier_transactions (id, business_id, supplier_id, transaction_type, amount_paise, note, user_id, created_at)
         VALUES (?, ?, ?, 'opening', ?, 'প্রারম্ভিক প্রদেয়', ?, ?)`
      ).run(generateId(), input.businessId, id, opening, input.userId ?? null, at);
    }
    recordAudit(db, { businessId: input.businessId, userId: input.userId, action: 'supplier.create', entityType: 'supplier', entityId: id, after: { name: input.name } });
  });
  return id;
}

export function updateSupplier(
  db: DB,
  id: string,
  patch: Partial<Omit<SupplierInput, 'businessId' | 'openingPayablePaise'>>,
  userId?: string
): void {
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) throw new NotFoundError('সাপ্লায়ার', id);
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [Date.now()];
  const map: [string, string][] = [
    ['name', 'name'], ['company', 'company'], ['phone', 'phone'], ['email', 'email'],
    ['address', 'address'], ['contactPerson', 'contact_person'], ['paymentTerms', 'payment_terms'], ['notes', 'notes']
  ];
  for (const [k, col] of map) {
    if (patch[k as keyof typeof patch] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(patch[k as keyof typeof patch]);
    }
  }
  if ('isActive' in patch) sets.push('is_active = ?'), params.push(patch.isActive ? 1 : 0);
  if (existing.payable_balance_paise !== 0) {
    throw new ConflictError('প্রদেয় থাকা সাপ্লায়ারের প্রোফাইল সম্পাদনায় সতর্ক থাকুন।');
  }
  db.prepare(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  recordAudit(db, { businessId: (existing.business_id as string), userId, action: 'supplier.update', entityType: 'supplier', entityId: id });
}

export function listSuppliers(
  db: DB,
  q: { businessId: string; search?: string; limit?: number; offset?: number; onlyWithPayable?: boolean }
) {
  const where = ['s.business_id = ?', 's.is_active = 1'];
  const params: unknown[] = [q.businessId];
  if (q.search) {
    where.push('(s.name LIKE ? OR s.phone LIKE ? OR s.company LIKE ?)');
    params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
  }
  if (q.onlyWithPayable) where.push('s.payable_balance_paise > 0');
  const limit = Math.min(q.limit ?? 50, 500);
  const rows = db
    .prepare(
      `SELECT s.*,
              COALESCE((SELECT SUM(amount_paise) FROM supplier_transactions st WHERE st.supplier_id = s.id AND st.transaction_type IN ('purchase','opening')), 0) AS total_purchases_paise,
              COALESCE((SELECT SUM(amount_paise) FROM supplier_transactions st WHERE st.supplier_id = s.id AND st.transaction_type = 'payment'), 0) AS total_paid_paise
       FROM suppliers s WHERE ${where.join(' AND ')}
       ORDER BY s.name COLLATE NOCASE ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, q.offset ?? 0) as Record<string, unknown>[];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM suppliers s WHERE ${where.join(' AND ')}`).get(...params) as { c: number };
  return { rows, total: total.c };
}

export function getSupplier(db: DB, id: string) {
  const row = db
    .prepare(
      `SELECT s.*,
              COALESCE((SELECT SUM(amount_paise) FROM supplier_transactions st WHERE st.supplier_id = s.id AND st.transaction_type IN ('purchase','opening')), 0) AS total_purchases_paise,
              COALESCE((SELECT SUM(amount_paise) FROM supplier_transactions st WHERE st.supplier_id = s.id AND st.transaction_type = 'payment'), 0) AS total_paid_paise,
              COALESCE((SELECT SUM(amount_paise) FROM supplier_transactions st WHERE st.supplier_id = s.id AND st.transaction_type = 'purchase_return'), 0) AS total_returns_paise
       FROM suppliers s WHERE s.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return row;
}

export function supplierLedger(db: DB, supplierId: string, from?: number, to?: number, limit = 300) {
  return db
    .prepare(
      `SELECT t.*, u.name AS user_name
       FROM supplier_transactions t LEFT JOIN users u ON u.id = t.user_id
       WHERE t.supplier_id = ? ${from !== undefined ? 'AND t.created_at >= ?' : ''} ${to !== undefined ? 'AND t.created_at <= ?' : ''}
       ORDER BY t.created_at DESC, t.id DESC LIMIT ?`
    )
    .all(supplierId, ...(from !== undefined ? [from] : []), ...(to !== undefined ? [to] : []), limit) as Record<string, unknown>[];
}

export interface PaySupplierInput {
  businessId: string;
  userId: string;
  supplierId: string;
  amountPaise: Paise;
  method: string;
  reference?: string;
  chequeNo?: string;
  bankName?: string;
  note?: string;
  at?: number;
}

/** Pay a supplier (§32). Money leaves an account; payable decreases. */
export function paySupplier(db: DB, input: PaySupplierInput): { id: string; referenceNo: string } {
  if (input.amountPaise <= 0) throw new ValidationError('পেমেন্টের অর্থ সঠিক নয়।');
  const sup = db
    .prepare('SELECT * FROM suppliers WHERE id = ? AND business_id = ?')
    .get(input.supplierId, input.businessId) as { id: string; name: string; payable_balance_paise: number } | undefined;
  if (!sup) throw new NotFoundError('সাপ্লায়ার', input.supplierId);
  if (input.amountPaise > sup.payable_balance_paise) {
    throw new ValidationError('প্রদেয়ের চেয়ে বেশি পেমেন্ট করা যায় না।');
  }
  const accountId = findAccountByMethod(db, input.businessId, input.method);
  if (!accountId) throw new ValidationError(`“${input.method}”-এর জন্য কোনো সক্রিয় হিসাব নেই।`);

  const id = generateId();
  let referenceNo = '';
  tx(db, () => {
    const n = allocateReference(db, REF_PREFIX.supplierPayment);
    referenceNo = formatReference(REF_PREFIX.supplierPayment, n);
    post(db, {
      businessId: input.businessId,
      accountId,
      type: 'supplier_payment',
      amountPaise: -input.amountPaise,
      referenceType: 'supplier_payment',
      referenceId: id,
      referenceNo,
      note: `সাপ্লায়ার পেমেন্ট — ${sup.name}`,
      userId: input.userId,
      at: input.at
    });
    postSupplierLedger(db, input.businessId, sup.id, {
      type: 'payment',
      amountPaise: input.amountPaise,
      referenceType: 'supplier_payment',
      referenceId: id,
      referenceNo,
      paymentMethod: input.method,
      note: input.note ?? `প্রদেয় পরিশোধ (${sup.name})`,
      userId: input.userId,
      at: input.at
    });
    recordAudit(db, {
      businessId: input.businessId, userId: input.userId, action: 'supplier.payment',
      entityType: 'supplier', entityId: sup.id, after: { amount: input.amountPaise, referenceNo }
    });
  });
  return { id, referenceNo };
}
