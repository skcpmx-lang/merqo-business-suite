/**
 * Returns service (§22, §33). Returns are reversal transactions —
 * the original document is never modified or deleted.
 *
 *  - Sales return: stock restored, money refunded (account) or receivable reduced.
 *  - Purchase return: stock reduced, supplier payable reduced (refund or adjustment).
 */
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { type Paise } from '../../shared/money';
import { recordAudit } from './auditService';
import { allocateReference } from '../repos/sequences';
import { formatReference, REF_PREFIX } from '../../shared/refs';
import { post, findAccountByMethod } from './accountService';
import { restock, issue, QTY_EPS } from './inventoryService';
import { postCustomerLedger, getSale } from './saleService';
import { postSupplierLedger, getPurchase } from './purchaseService';
import { ValidationError, NotFoundError, ConflictError } from '../errors';

// ---------------- SALES RETURN ----------------

export interface SalesReturnItemInput {
  saleItemId: string;
  quantity: number;
  restock: boolean;
}

export interface CreateSalesReturnInput {
  businessId: string;
  userId: string;
  saleId: string;
  reason?: string;
  items: SalesReturnItemInput[];
  /** 'refund' → money back from account | 'receivable' → reduce customer due */
  refundMethod?: 'refund' | 'receivable';
  refundPaymentMethod?: string;
  at?: number;
}

export function createSalesReturn(db: DB, input: CreateSalesReturnInput) {
  const sale = getSale(db, input.businessId, input.saleId);
  if (!sale) throw new NotFoundError('বিক্রয়', input.saleId);
  if (sale.status === 'voided') throw new ConflictError('বিলগা করা বিক্রয়ের ফেরত নেওয়া যায় না।');

  const saleId = sale.id as string;
  const customer: string | null = (sale.customer_id as string | null) ?? null;
  const totalPaise = sale.total_paise as number;
  const duePaise = sale.due_paise as number;
  const paidPaise = sale.paid_paise as number;

  // Validate quantities against returned-so-far
  const alreadyReturned = db
    .prepare(
      `SELECT si.id AS sale_item_id, COALESCE(SUM(sri.quantity), 0) AS returned
       FROM sales_return_items sri JOIN sales_returns sr ON sr.id = sri.return_id
       JOIN sale_items si ON si.id = sri.sale_item_id
       WHERE si.sale_id = ? GROUP BY si.id`
    )
    .all(saleId) as { sale_item_id: string; returned: number }[];
  const returnedMap = new Map(alreadyReturned.map((r) => [r.sale_item_id, r.returned]));

  const saleItems = db
    .prepare('SELECT * FROM sale_items WHERE sale_id = ?')
    .all(saleId) as {
      id: string; product_id: string; product_name_snapshot: string; quantity: number;
      unit_price_paise: number; discount_paise: number; tax_paise: number; line_total_paise: number; cogs_paise: number;
    }[];

  let totalRefund = 0;
  let totalCogs = 0;
  const lines = input.items.map((it) => {
    const item = saleItems.find((s) => s.id === it.saleItemId);
    if (!item) throw new NotFoundError('বিক্রয় আইটেম', it.saleItemId);
    const already = returnedMap.get(it.saleItemId) ?? 0;
    if (it.quantity + already > item.quantity + QTY_EPS) {
      throw new ValidationError(`“${item.product_name_snapshot}”-এর ফেরত পরিমাণ বিক্রয় পরিমাণের বেশি হতে পারে না।`);
    }
    // prorate line totals by quantity
    const frac = it.quantity / item.quantity;
    const lineTotal = Math.round(item.line_total_paise * frac);
    // COGS of the returned quantity (restocked lines only) — kept so profit
    // aggregates can net it out against the sale's COGS.
    const lineCogs = it.restock ? Math.round(item.cogs_paise * frac) : 0;
    totalRefund += lineTotal;
    totalCogs += lineCogs;
    return { item, qty: it.quantity, restock: it.restock, lineTotal, lineCogs };
  });
  if (totalRefund <= 0) throw new ValidationError('ফেরতের পরিমাণ সঠিক নয়।');
  if (totalRefund > totalPaise) throw new ValidationError('ফেরতের অর্থ বিক্রয়ের মোটের বেশি হতে পারে না।');

  // refund vs receivable: customer with due → default to receivable adjustment
  const method = input.refundMethod ?? (customer && duePaise > 0 ? 'receivable' : 'refund');

  const returnId = generateId();
  let referenceNo = '';
  let accountRefund = 0;
  let receivableReduction = 0;
  const at = input.at ?? Date.now();

  tx(db, () => {
    const n = allocateReference(db, REF_PREFIX.saleReturn);
    referenceNo = formatReference(REF_PREFIX.saleReturn, n);

    db.prepare(
      `INSERT INTO sales_returns
       (id, business_id, sale_id, customer_id, reference_no, date, reason, total_paise, refund_paise, cogs_paise, status, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`
    ).run(returnId, input.businessId, saleId, customer, referenceNo, at, input.reason ?? '', totalRefund, totalRefund, totalCogs, input.userId, at);

    for (const l of lines) {
      db.prepare(
        `INSERT INTO sales_return_items
         (id, business_id, return_id, sale_item_id, product_id, quantity, unit_price_paise, line_total_paise, restock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateId(), input.businessId, returnId, l.item.id, l.item.product_id, l.qty,
        l.item.unit_price_paise, l.lineTotal, l.restock ? 1 : 0
      );
      if (l.restock) {
        restock(db, {
          businessId: input.businessId,
          productId: l.item.product_id,
          quantity: l.qty,
          unitCostPaise: Math.round(l.item.cogs_paise / Math.max(l.item.quantity, QTY_EPS)),
          movementType: 'sales_return',
          referenceType: 'sales_return',
          referenceId: returnId,
          userId: input.userId,
          at
        });
      }
    }

    // Settlement split: 'receivable' reduces the customer's due only up to
    // what is actually owed; the remainder (e.g. the pre-paid portion of the
    // sale) comes back from the account. 'refund' pays the full amount from
    // the account. This keeps the customer due from going negative and the
    // cash in hand always true.
    if (method === 'receivable' && customer && duePaise > 0) {
      receivableReduction = Math.min(totalRefund, duePaise);
      accountRefund = totalRefund - receivableReduction;
    } else {
      accountRefund = totalRefund;
    }

    if (receivableReduction > 0 && customer) {
      postCustomerLedger(db, input.businessId, customer, {
        type: 'sale_return',
        amountPaise: receivableReduction,
        referenceType: 'sales_return',
        referenceId: returnId,
        referenceNo,
        note: `বিক্রয় ফেরত ${referenceNo} — বকেয়া কমানো`,
        userId: input.userId,
        at
      });
      // Keep the sale's own outstanding balance in sync: reports compute
      // current credit dues from sales.due_paise, so every receivable
      // reduction here must come out of it (never below zero).
      db.prepare('UPDATE sales SET due_paise = MAX(0, due_paise - ?), updated_at = ? WHERE id = ?')
        .run(receivableReduction, at, saleId);
    }
    if (accountRefund > 0) {
      const refundAccount = findAccountByMethod(db, input.businessId, input.refundPaymentMethod ?? 'cash');
      if (!refundAccount) throw new ValidationError('ফেরতের জন্য সক্রিয় হিসাব নেই।');
      post(db, {
        businessId: input.businessId,
        accountId: refundAccount,
        type: 'sale_refund',
        amountPaise: -accountRefund,
        referenceType: 'sales_return',
        referenceId: returnId,
        referenceNo,
        note: `বিক্রয় ফেরত ${referenceNo}`,
        userId: input.userId,
        at
      });
    }

    // Update sale status based on how much of each line has been returned
    // (SUM of all non-voided return rows — a line is fully returned only
    // when its accumulated returned quantity reaches the sold quantity).
    const hasUnreturned = db
      .prepare(
        `SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE 1 END AS has_unreturned
         FROM sale_items si
         WHERE si.sale_id = ?
           AND (
             SELECT COALESCE(SUM(sri.quantity), 0)
             FROM sales_return_items sri
             JOIN sales_returns sr ON sr.id = sri.return_id
             WHERE sri.sale_item_id = si.id AND sr.status <> 'voided'
           ) + 0.00001 < si.quantity`
      )
      .get(saleId) as { has_unreturned: number };
    const newStatus = hasUnreturned.has_unreturned ? 'partially_refunded' : 'refunded';
    db.prepare('UPDATE sales SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, at, saleId);

    recordAudit(db, {
      businessId: input.businessId, userId: input.userId, action: 'sale.return',
      entityType: 'sales_return', entityId: returnId,
      after: { saleId, referenceNo, amount: totalRefund, method },
      at
    });
  });

  return {
    returnId, referenceNo, totalRefundPaise: totalRefund,
    method,
    accountRefundPaise: accountRefund,
    receivableReductionPaise: receivableReduction,
    cogsPaise: totalCogs,
    saleStatus: db.prepare('SELECT status FROM sales WHERE id = ?').get(saleId) as { status: string }
  };
}

// ---------------- PURCHASE RETURN ----------------

export interface PurchaseReturnItemInput {
  purchaseItemId: string;
  quantity: number;
}

export interface CreatePurchaseReturnInput {
  businessId: string;
  userId: string;
  purchaseId: string;
  reason?: string;
  items: PurchaseReturnItemInput[];
  /** 'adjust' → reduce payable | 'refund' → money back to account */
  settlement?: 'adjust' | 'refund';
  refundPaymentMethod?: string;
  at?: number;
}

export function createPurchaseReturn(db: DB, input: CreatePurchaseReturnInput) {
  const purchase = getPurchase(db, input.businessId, input.purchaseId);
  if (!purchase) throw new NotFoundError('ক্রয়', input.purchaseId);

  const purchaseId = purchase.id as string;
  const supplierId = purchase.supplier_id as string;

  const alreadyReturned = db
    .prepare(
      `SELECT pri.purchase_item_id, COALESCE(SUM(pri.quantity), 0) AS returned
       FROM purchase_return_items pri
       JOIN purchase_returns pr ON pr.id = pri.return_id
       WHERE pr.purchase_id = ? AND pr.status <> 'voided'
       GROUP BY pri.purchase_item_id`
    )
    .all(purchaseId) as { purchase_item_id: string; returned: number }[];
  const returnedMap = new Map(alreadyReturned.map((r) => [r.purchase_item_id, r.returned]));

  const purchaseItems = db
    .prepare('SELECT * FROM purchase_items WHERE purchase_id = ?')
    .all(purchaseId) as {
      id: string; product_id: string; product_name_snapshot: string; quantity: number;
      unit_cost_paise: number; discount_paise: number; tax_paise: number; line_total_paise: number;
    }[];

  let total = 0;
  const lines = input.items.map((it) => {
    const item = purchaseItems.find((p) => p.id === it.purchaseItemId);
    if (!item) throw new NotFoundError('ক্রয় আইটেম', it.purchaseItemId);
    const already = returnedMap.get(it.purchaseItemId) ?? 0;
    if (it.quantity + already > item.quantity + QTY_EPS) {
      throw new ValidationError(`“${item.product_name_snapshot}”-এর ফেরত পরিমাণ ক্রয় পরিমাণের বেশি হতে পারে না।`);
    }
    const frac = it.quantity / item.quantity;
    const lineTotal = Math.round(item.line_total_paise * frac);
    total += lineTotal;
    return { item, qty: it.quantity, lineTotal };
  });
  if (total <= 0) throw new ValidationError('ফেরতের পরিমাণ সঠিক নয়।');
  if (total > (purchase.total_paise as number)) {
    throw new ValidationError('ফেরতের অর্থ ক্রয়ের মোটের বেশি হতে পারে না।');
  }

  const settlement = input.settlement ?? 'adjust';
  const returnId = generateId();
  let referenceNo = '';
  const at = input.at ?? Date.now();

  tx(db, () => {
    const n = allocateReference(db, REF_PREFIX.purchaseReturn);
    referenceNo = formatReference(REF_PREFIX.purchaseReturn, n);

    db.prepare(
      `INSERT INTO purchase_returns
       (id, business_id, purchase_id, supplier_id, reference_no, date, reason, total_paise, refund_paise, status, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`
    ).run(returnId, input.businessId, purchaseId, supplierId, referenceNo, at, input.reason ?? '', total, total, input.userId, at);

    for (const l of lines) {
      db.prepare(
        `INSERT INTO purchase_return_items
         (id, business_id, return_id, purchase_item_id, product_id, quantity, unit_cost_paise, line_total_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(generateId(), input.businessId, returnId, l.item.id, l.item.product_id, l.qty, l.item.unit_cost_paise, l.lineTotal);
      issue(db, {
        businessId: input.businessId,
        productId: l.item.product_id,
        quantity: l.qty,
        movementType: 'purchase_return',
        referenceType: 'purchase_return',
        referenceId: returnId,
        userId: input.userId,
        at,
        allowNegative: false
      });
    }

    if (settlement === 'refund') {
      const account = findAccountByMethod(db, input.businessId, input.refundPaymentMethod ?? 'cash');
      if (!account) throw new ValidationError('ফেরতের জন্য সক্রিয় হিসাব নেই।');
      post(db, {
        businessId: input.businessId,
        accountId: account,
        type: 'purchase_refund',
        amountPaise: total,
        referenceType: 'purchase_return',
        referenceId: returnId,
        referenceNo,
        note: `ক্রয় ফেরত ${referenceNo}`,
        userId: input.userId,
        at
      });
    }

    postSupplierLedger(db, input.businessId, supplierId, {
      type: 'purchase_return',
      amountPaise: total,
      referenceType: 'purchase_return',
      referenceId: returnId,
      referenceNo,
      note: `ক্রয় ফেরত ${referenceNo}`,
      userId: input.userId,
      at
    });

    recordAudit(db, {
      businessId: input.businessId, userId: input.userId, action: 'purchase.return',
      entityType: 'purchase_return', entityId: returnId,
      after: { purchaseId, referenceNo, amount: total, settlement },
      at
    });
  });

  return { returnId, referenceNo, totalPaise: total };
}
