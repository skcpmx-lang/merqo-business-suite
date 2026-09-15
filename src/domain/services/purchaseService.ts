/**
 * Purchase service (§30). Atomic flow:
 *   validate → number → header+items → stock in (weighted avg cost)
 *   → optional batch creation → supplier payable (due) → payments → audit
 */
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { roundToPaise, fromPaise, percentPaise, type Paise } from '../../shared/money';
import { recordAudit } from './auditService';
import { getFinancialSettings } from '../repos/settings';
import { allocateReference } from '../repos/sequences';
import { formatReference, REF_PREFIX } from '../../shared/refs';
import { getProduct, insertBatch, listBrands } from '../repos/master';
import { post, findAccountByMethod } from './accountService';
import { receive, roundQty } from './inventoryService';
import {
  ValidationError, NotFoundError, ConflictError, InvalidStateError
} from '../errors';

export interface PurchaseLineInput {
  productId: string;
  quantity: number;
  unitCostPaise: Paise;
  discountPaise?: Paise;
  batchNo?: string;
  expiryDate?: number | null;
}

export interface PurchasePaymentInput {
  method: string;
  amountPaise: Paise;
  reference?: string;
  chequeNo?: string;
  bankName?: string;
  chequeDate?: number;
}

export interface CreatePurchaseInput {
  businessId: string;
  userId: string;
  supplierId: string;
  supplierInvoiceNo?: string;
  lines: PurchaseLineInput[];
  payments: PurchasePaymentInput[];
  note?: string;
  at?: number;
}

export function createPurchase(db: DB, input: CreatePurchaseInput): {
  purchaseId: string; referenceNo: string; totalPaise: Paise; paidPaise: Paise; duePaise: Paise;
} {
  if (input.lines.length === 0) throw new ValidationError('কমপক্ষে একটি পণ্য যোগ করুন।');
  const supplier = db
    .prepare('SELECT * FROM suppliers WHERE id = ? AND business_id = ? AND is_active = 1')
    .get(input.supplierId, input.businessId) as
    | { id: string; business_id: string }
    | undefined;
  if (!supplier) throw new NotFoundError('সাপ্লায়ার', input.supplierId);

  const fin = getFinancialSettings(db, input.businessId);
  const now = input.at ?? Date.now();

  // Validate & compute
  const lines = input.lines.map((li) => {
    const qty = roundQty(li.quantity);
    if (qty <= 0) throw new ValidationError('পরিমাণ সঠিক নয়।');
    if (li.unitCostPaise < 0) throw new ValidationError('খরচদাম ঋণাত্মক হতে পারে না।');
    const product = getProduct(db, li.productId);
    if (!product) throw new NotFoundError('পণ্য', li.productId);
    const gross = roundToPaise(fromPaise(li.unitCostPaise) * qty);
    const discount = li.discountPaise ?? 0;
    if (discount < 0 || discount > gross) throw new ValidationError('ছাড় সঠিক নয়।');
    let tax: Paise = 0;
    if (fin.tax_enabled && fin.tax_rate_bps > 0) {
      tax = fin.tax_inclusive_prices
        ? roundToPaise(((gross - discount) * fin.tax_rate_bps) / (10000 + fin.tax_rate_bps))
        : percentPaise(gross - discount, fin.tax_rate_bps);
    }
    return { li, qty, product, gross, discount, tax, net: gross - discount + tax };
  });

  const subtotal = lines.reduce((s, l) => s + l.gross, 0);
  const discount = lines.reduce((s, l) => s + l.discount, 0);
  const tax = lines.reduce((s, l) => s + l.tax, 0);
  const total = subtotal - discount + tax;

  let received = 0;
  for (const p of input.payments) {
    if (p.amountPaise < 0) throw new ValidationError('পেমেন্টের অর্থ সঠিক নয়।');
    received += p.amountPaise;
    if (p.amountPaise > 0 && !findAccountByMethod(db, input.businessId, p.method)) {
      throw new ValidationError(`“${p.method}”-এর জন্য কোনো সক্রিয় হিসাব নেই।`);
    }
  }
  if (received > total) {
    // advance payment beyond this invoice — reject to keep ledgers simple
    throw new ValidationError('পেমেন্ট ক্রয়ের মোটের চেয়ে বেশি হতে পারে না।');
  }
  const due = total - received;

  const purchaseId = generateId();
  let referenceNo = '';

  tx(db, () => {
    const n = allocateReference(db, REF_PREFIX.purchase);
    referenceNo = formatReference(REF_PREFIX.purchase, n);

    db.prepare(
      `INSERT INTO purchases
       (id, business_id, supplier_id, reference_no, supplier_invoice_no, date,
        subtotal_paise, discount_paise, tax_paise, total_paise, paid_paise, due_paise,
        status, note, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      purchaseId, input.businessId, supplier.id, referenceNo, input.supplierInvoiceNo ?? '', now,
      subtotal, discount, tax, total, received, due,
      due > 0 ? 'partially_paid' : 'paid', input.note ?? '', input.userId, now, now
    );

    for (const l of lines) {
      const itemId = generateId();
      let batchId: string | null = null;
      if (l.product.batch_enabled) {
        batchId = insertBatch(db, {
          businessId: input.businessId,
          productId: l.product.id,
          batchNo: l.li.batchNo ?? '',
          expiryDate: l.li.expiryDate ?? null,
          quantity: l.qty,
          unitCostPaise: l.li.unitCostPaise,
          supplierId: supplier.id
        });
      }
      db.prepare(
        `INSERT INTO purchase_items
         (id, business_id, purchase_id, product_id, batch_id, product_name_snapshot,
          quantity, unit_cost_paise, discount_paise, tax_paise, line_total_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        itemId, input.businessId, purchaseId, l.product.id, batchId, l.product.name,
        l.qty, l.li.unitCostPaise, l.discount, l.tax, l.net
      );
      // Stock in at this invoice's net unit cost (discount/tax apportioned)
      receive(db, {
        businessId: input.businessId,
        productId: l.product.id,
        quantity: l.qty,
        unitCostPaise: Math.round(l.net / l.qty),
        movementType: 'purchase',
        referenceType: 'purchase',
        referenceId: purchaseId,
        userId: input.userId,
        at: now
      });

      // Keep product master purchase price in sync (latest cost)
      db.prepare('UPDATE products SET purchase_price_paise = ?, updated_at = ? WHERE id = ?')
        .run(l.li.unitCostPaise, now, l.product.id);
    }

    // Payments
    for (const p of input.payments) {
      if (p.amountPaise <= 0) continue;
      const accountId = findAccountByMethod(db, input.businessId, p.method)!;
      post(db, {
        businessId: input.businessId,
        accountId,
        type: 'purchase_payment',
        amountPaise: -p.amountPaise,
        referenceType: 'purchase',
        referenceId: purchaseId,
        referenceNo,
        note: `ক্রয় ${referenceNo}`,
        userId: input.userId,
        at: now
      });
      db.prepare(
        `INSERT INTO purchase_payments
         (id, business_id, purchase_id, amount_paise, payment_method, account_id, reference,
          cheque_no, bank_name, cheque_date, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateId(), input.businessId, purchaseId, p.amountPaise, p.method, accountId,
        p.reference ?? '', p.chequeNo ?? '', p.bankName ?? '', p.chequeDate ?? null, input.userId, now
      );
    }

    // Supplier payable
    if (due > 0) {
      postSupplierLedger(db, input.businessId, supplier.id as string, {
        type: 'purchase',
        amountPaise: due,
        referenceType: 'purchase',
        referenceId: purchaseId,
        referenceNo,
        note: `উজড় ক্রয় ${referenceNo}`,
        userId: input.userId,
        at: now
      });
    }

    recordAudit(db, {
      businessId: input.businessId,
      userId: input.userId,
      action: 'purchase.create',
      entityType: 'purchase',
      entityId: purchaseId,
      after: { referenceNo, total, paid: received, due, lines: lines.length, supplier: supplier.id },
      at: now
    });
  });

  return { purchaseId, referenceNo, totalPaise: total, paidPaise: received, duePaise: due };
}

// ---------------- Supplier payable funnel ----------------

export interface SupplierLedgerPost {
  /** 'purchase' (payable +) | 'payment' (payable −) | 'purchase_return' (payable −) */
  type: string;
  amountPaise: Paise;
  referenceType?: string;
  referenceId?: string;
  referenceNo?: string;
  paymentMethod?: string;
  note?: string;
  userId?: string | null;
  at?: number;
}

export function postSupplierLedger(
  db: DB,
  businessId: string,
  supplierId: string,
  entry: SupplierLedgerPost
): void {
  const sup = db
    .prepare('SELECT id, payable_balance_paise FROM suppliers WHERE id = ? AND business_id = ?')
    .get(supplierId, businessId) as { id: string; payable_balance_paise: number } | undefined;
  if (!sup) throw new NotFoundError('সাপ্লায়ার', supplierId);
  const delta = entry.type === 'purchase' ? entry.amountPaise : -entry.amountPaise;
  const newBal = sup.payable_balance_paise + delta;
  if (newBal < 0) {
    throw new ValidationError('প্রদেয় ঋণাত্মক হতে পারে না।');
  }
  db.prepare(
    `INSERT INTO supplier_transactions
     (id, business_id, supplier_id, transaction_type, amount_paise, reference_type, reference_id,
      reference_no, payment_method, account_id, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(
    generateId(), businessId, supplierId, entry.type, entry.amountPaise,
    entry.referenceType ?? null, entry.referenceId ?? null, entry.referenceNo ?? null,
    entry.paymentMethod ?? null, entry.note ?? '', entry.userId ?? null, entry.at ?? Date.now()
  );
  db.prepare('UPDATE suppliers SET payable_balance_paise = ?, updated_at = ? WHERE id = ?')
    .run(newBal, Date.now(), supplierId);
}

// ---------------- Lookups ----------------

export interface PurchaseRecord {
  id: string;
  business_id: string;
  supplier_id: string;
  reference_no: string;
  supplier_invoice_no: string;
  date: number;
  subtotal_paise: number;
  discount_paise: number;
  tax_paise: number;
  total_paise: number;
  paid_paise: number;
  due_paise: number;
  status: string;
  note: string;
  user_id: string | null;
  created_at: number;
  updated_at: number;
  supplier_name?: string | null;
  user_name?: string | null;
}

export interface PurchaseItemRecord {
  id: string;
  purchase_id: string;
  product_id: string;
  product_name_snapshot: string;
  quantity: number;
  unit_cost_paise: number;
  discount_paise: number;
  tax_paise: number;
  line_total_paise: number;
}

export interface PurchasePaymentRecord {
  id: string;
  purchase_id: string;
  amount_paise: number;
  payment_method: string;
  account_id: string | null;
  reference: string;
  user_id: string | null;
  created_at: number;
}

export function getPurchase(db: DB, businessId: string, idOrRef: string): (PurchaseRecord & {
  items: PurchaseItemRecord[];
  payments: PurchasePaymentRecord[];
}) | undefined {
  const row = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name, u.name AS user_name
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.business_id = ? AND (p.id = ? OR p.reference_no = ?)`
    )
    .get(businessId, idOrRef, idOrRef) as PurchaseRecord | undefined;
  if (!row) return undefined;
  return {
    ...row,
    items: db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY rowid').all(row.id) as PurchaseItemRecord[],
    payments: db.prepare('SELECT * FROM purchase_payments WHERE purchase_id = ? ORDER BY created_at').all(row.id) as PurchasePaymentRecord[]
  };
}

export function queryPurchases(
  db: DB,
  q: { businessId: string; from?: number; to?: number; supplierId?: string; search?: string; limit?: number; offset?: number }
) {
  const where = ['p.business_id = ?'];
  const params: unknown[] = [q.businessId];
  if (q.from !== undefined) { where.push('p.date >= ?'); params.push(q.from); }
  if (q.to !== undefined) { where.push('p.date <= ?'); params.push(q.to); }
  if (q.supplierId) { where.push('p.supplier_id = ?'); params.push(q.supplierId); }
  if (q.search) { where.push('(p.reference_no LIKE ? OR s.name LIKE ? OR p.supplier_invoice_no LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  const limit = Math.min(q.limit ?? 50, 500);
  const rows = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name,
              (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count
       FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.date DESC, p.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, q.offset ?? 0) as Record<string, unknown>[];
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE ${where.join(' AND ')}`)
    .get(...params) as { c: number };
  return { rows, total: total.c };
}

export { listBrands, InvalidStateError };
