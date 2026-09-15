/**
 * Sale service — the heart of POS (§7, §15–§23).
 *
 * Atomic flow (all-or-nothing):
 *   validate → number → header+items → deduct stock (COGS @ avg cost)
 *   → post payments to accounts → update customer receivable → audit
 *
 * Rules:
 *  - payments may split across methods (§19); overpayment only via cash (change)
 *  - credit sale requires a customer; credit limit enforced with explicit override (§112)
 *  - void/return are reversals — the original sale is never deleted (§22, §58)
 *  - prices: below-min-price / discount require flags granted by the permission layer
 */
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { roundToPaise, fromPaise, type Paise } from '../../shared/money';
import { prorateOrderDiscount, taxForBase } from '../../shared/saleMath';
import { recordAudit } from './auditService';
import { getFinancialSettings } from '../repos/settings';
import { allocateReference } from '../repos/sequences';
import { formatReference, REF_PREFIX } from '../../shared/refs';
import { findProductByBarcode, getProduct, listActiveBatches, adjustBatchQuantity } from '../repos/master';
import { post, findAccountByMethod } from './accountService';
import { issue, receive, roundQty, QTY_EPS } from './inventoryService';
import {
  ValidationError, NotFoundError, ConflictError, CreditLimitError, InvalidStateError
} from '../errors';

export interface SaleLineInput {
  productId: string;
  quantity: number;
  unitPricePaise?: Paise;
  discountPaise?: Paise;
}

export interface SalePaymentInput {
  method: string;
  amountPaise: Paise;
  reference?: string;
  chequeNo?: string;
  bankName?: string;
  chequeDate?: number;
}

export interface CreateSaleInput {
  businessId: string;
  userId: string;
  customerId?: string | null;
  lines: SaleLineInput[];
  payments: SalePaymentInput[];
  note?: string;
  at?: number;
  /** order-level discount in paise (applied after line discounts, prorated for tax) */
  orderDiscountPaise?: Paise;
  /** permission-derived flags */
  allowBelowMinPrice?: boolean;
  allowDiscount?: boolean;
  /** explicit override of credit limit breach (§112) */
  overrideCreditLimit?: boolean;
  /** explicit allowance to sell beyond stock (must also be enabled in settings) */
  allowNegativeStock?: boolean;
  /** client-generated idempotency token (double-submission guard, §103) */
  idempotencyKey?: string;
}

export interface SaleLineResult {
  productId: string;
  productName: string;
  quantity: number;
  unitPricePaise: Paise;
  discountPaise: Paise;
  taxPaise: Paise;
  lineTotalPaise: Paise;
  cogsPaise: Paise;
}

export interface SaleResult {
  saleId: string;
  referenceNo: string;
  subtotalPaise: Paise;
  discountPaise: Paise;
  taxPaise: Paise;
  totalPaise: Paise;
  paidPaise: Paise;
  duePaise: Paise;
  changePaise: Paise;
  cogsPaise: Paise;
  grossProfitPaise: Paise;
  lines: SaleLineResult[];
  status: string;
}

interface ComputedLine {
  input: SaleLineInput;
  productName: string;
  unitId: string;
  sku: string;
  barcode: string;
  qty: number;
  unitPricePaise: Paise;
  grossPaise: Paise;
  discountPaise: Paise;
  /** this line's share of the order-level discount */
  orderDiscountPaise: Paise;
  taxPaise: Paise;
  netPaise: Paise;
  restockable: boolean;
  cogsPaise: Paise;
}

function computeLines(db: DB, input: CreateSaleInput, fin: ReturnType<typeof getFinancialSettings>): ComputedLine[] {
  const lines: ComputedLine[] = [];
  const seen = new Map<string, ComputedLine>();
  for (const li of input.lines) {
    const qty = roundQty(li.quantity);
    if (qty <= 0) throw new ValidationError('পরিমাণ সঠিক নয়।');
    const product = getProduct(db, li.productId);
    if (!product) throw new NotFoundError('পণ্য', li.productId);
    if (product.status === 'deleted') throw new NotFoundError('পণ্য', li.productId);
    if (product.status === 'inactive') throw new InvalidStateError(`“${product.name}” পণ্যটি নিষ্ক্রিয়।`);

    let unitPrice = li.unitPricePaise ?? product.promotional_price_paise ?? product.selling_price_paise;
    const minPrice = product.min_selling_price_paise;
    if (unitPrice < minPrice && !input.allowBelowMinPrice) {
      throw new ValidationError(`“${product.name}”-এর ন্যূনতম বিক্রয় মূল্য অতিক্রম হয়েছে। অনুমতি প্রয়োজন।`);
    }
    if (unitPrice < 0) throw new ValidationError('দাম ঋণাত্মক হতে পারে না।');

    let discount = li.discountPaise ?? 0;
    if (discount < 0) throw new ValidationError('ছাড় ঋণাত্মক হতে পারে না।');
    if (discount > 0 && !input.allowDiscount) {
      throw new ValidationError('ছাড় দেওয়ার অনুমতি নেই।');
    }

    const gross = roundToPaise(fromPaise(unitPrice) * qty);
    if (discount > gross) throw new ValidationError(`“${product.name}”-এর ছাড় লাইন মূল্যের বেশি হতে পারে না।`);

    const existing = seen.get(li.productId);
    const line: ComputedLine = existing
      ? existing
      : {
          input: li, productName: product.name, unitId: product.unit_id, sku: product.sku,
          barcode: product.primary_barcode ?? '', qty: 0, unitPricePaise: unitPrice,
          grossPaise: 0, discountPaise: 0, orderDiscountPaise: 0, taxPaise: 0,
          netPaise: 0, restockable: true, cogsPaise: 0
        };
    if (existing) {
      // same product twice — require identical price to keep the line sane
      if (existing.unitPricePaise !== unitPrice) {
        throw new ValidationError(`“${product.name}”-এর একাধিক লাইনে একই দাম ব্যবহার করুন।`);
      }
      line.qty = roundQty(line.qty + qty);
      line.grossPaise += gross;
      line.discountPaise += discount;
    } else {
      line.qty = qty;
      line.grossPaise = gross;
      line.discountPaise = discount;
      seen.set(li.productId, line);
      lines.push(line);
    }
  }
  // Order-level discount: prorate across lines by pre-discount base so the
  // parts sum exactly to the whole, then apply tax per line (shared math,
  // identical to the POS preview).
  const orderDiscount = Math.max(0, Math.floor(input.orderDiscountPaise ?? 0));
  const bases = lines.map((l) => Math.max(0, l.grossPaise - l.discountPaise));
  const totalBase = bases.reduce((s, b) => s + b, 0);
  if (orderDiscount > totalBase) {
    throw new ValidationError('সামগ্রিক ছাড় লাইন মূল্যের বেশি হতে পারে না।');
  }
  const alloc = prorateOrderDiscount(bases, orderDiscount);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    line.orderDiscountPaise = alloc[i];
    const netBase = bases[i] - alloc[i];
    line.taxPaise = taxForBase(netBase, fin);
    line.netPaise = netBase + line.taxPaise;
  }
  return lines;
}

export function getSaleTotals(lines: ComputedLine[]) {
  const subtotal = lines.reduce((s, l) => s + l.grossPaise, 0);
  // line discounts + prorated order discount
  const discount = lines.reduce((s, l) => s + l.discountPaise + l.orderDiscountPaise, 0);
  const tax = lines.reduce((s, l) => s + l.taxPaise, 0);
  const total = subtotal - discount + tax;
  return { subtotal, discount, tax, total };
}

function validatePayments(db: DB, input: CreateSaleInput, total: Paise) {
  let received = 0;
  let cashReceived = 0;
  if (input.payments.length === 0 && total > 0) {
    // credit sale — no payment at all
  }
  for (const p of input.payments) {
    if (p.amountPaise < 0) throw new ValidationError('পেমেন্টের অর্থ সঠিক নয়।');
    received += p.amountPaise;
    if (p.method === 'cash') cashReceived += p.amountPaise;
    if (p.amountPaise > 0) {
      const acc = findAccountByMethod(db, input.businessId, p.method);
      if (!acc) throw new ValidationError(`“${p.method}”-এর জন্য কোনো সক্রিয় হিসাব নেই।`);
    }
  }
  const change = received - total;
  if (change < 0) return { received, change, due: -change, customerRequired: true };
  if (change > 0 && cashReceived < change) {
    throw new ValidationError('ফেরত অর্থ (change) শুধু নগদ পেমেন্ট থেকেই সম্ভব।');
  }
  return { received, change, due: 0, customerRequired: false };
}

export function createSale(db: DB, input: CreateSaleInput): SaleResult {
  if (input.lines.length === 0) throw new ValidationError('কার্ট খালি। কমপক্ষে একটি পণ্য যোগ করুন।');
  const fin = getFinancialSettings(db, input.businessId);
  const lines = computeLines(db, input, fin);
  const totals = getSaleTotals(lines);
  const pay = validatePayments(db, input, totals.total);

  // Credit sale needs a customer
  let customerId: string | null = input.customerId ?? null;
  if (pay.customerRequired || input.customerId) {
    if (!customerId) throw new ValidationError('উজড়ের জন্য কাস্টমার নির্বাচন করুন।');
  }

  // Credit limit check
  if (customerId && pay.due > 0) {
    const cust = db
      .prepare('SELECT name, credit_limit_paise, due_balance_paise FROM customers WHERE id = ? AND business_id = ? AND is_active = 1')
      .get(customerId, input.businessId) as { name: string; credit_limit_paise: number; due_balance_paise: number } | undefined;
    if (!cust) throw new NotFoundError('কাস্টমার', customerId);
    const newDue = cust.due_balance_paise + pay.due;
    if (cust.credit_limit_paise > 0 && newDue > cust.credit_limit_paise && !input.overrideCreditLimit) {
      throw new CreditLimitError(cust.name, cust.credit_limit_paise, newDue);
    }
  }

  const at = input.at ?? Date.now();
  const saleId = generateId();
  let referenceNo = '';
  let cogs = 0;

  tx(db, () => {
    const n = allocateReference(db, REF_PREFIX.sale);
    referenceNo = formatReference(REF_PREFIX.sale, n);

    // Header
    db.prepare(
      `INSERT INTO sales
       (id, business_id, customer_id, reference_no, date, subtotal_paise, discount_paise, tax_paise,
        total_paise, paid_paise, due_paise, cogs_paise, status, note, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'completed', ?, ?, ?, ?)`
    ).run(
      saleId, input.businessId, customerId, referenceNo, at,
      totals.subtotal, totals.discount, totals.tax, totals.total,
      pay.received < totals.total ? pay.received : totals.total,
      pay.due, input.note ?? '', input.userId, at, at
    );

    // Items + stock
    const allowNeg = input.allowNegativeStock && fin.allow_negative_stock;
    for (const line of lines) {
      const product = getProduct(db, line.input.productId)!;
      const expiryCheck = checkExpiredBatches(db, line.input.productId, fin);
      if (expiryCheck.blocked && fin.block_sale_expired) {
        throw new InvalidStateError(`“${line.productName}”-এর স্টক মেয়াদোত্তীর্ণ — বিক্রয় বন্ধ।`);
      }
      const { cogsPaise } = issue(db, {
        businessId: input.businessId,
        productId: line.input.productId,
        quantity: line.qty,
        movementType: 'sale',
        referenceType: 'sale',
        referenceId: saleId,
        userId: input.userId,
        at,
        allowNegative: allowNeg
      });
      consumeBatches(db, line.input.productId, line.qty, at);
      cogs += cogsPaise;
      line.cogsPaise = cogsPaise;
      db.prepare(
        `INSERT INTO sale_items
         (id, business_id, sale_id, product_id, product_name_snapshot, sku_snapshot, barcode_snapshot,
          unit_id, quantity, unit_price_paise, discount_paise, tax_paise, line_total_paise, cogs_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateId(), input.businessId, saleId, line.input.productId, line.productName, line.sku,
        line.barcode, line.unitId, line.qty, line.unitPricePaise, line.discountPaise,
        line.taxPaise, line.netPaise, cogsPaise
      );
    }

    // Payments → accounts (net of change on the first cash leg)
    let posted = 0;
    let changeApplied = false;
    for (const p of input.payments) {
      if (p.amountPaise <= 0) continue;
      let net = p.amountPaise;
      if (p.method === 'cash' && pay.change > 0 && !changeApplied) {
        net -= pay.change;
        changeApplied = true;
      }
      if (net <= 0) continue;
      const accountId = findAccountByMethod(db, input.businessId, p.method)!;
      post(db, {
        businessId: input.businessId,
        accountId,
        type: 'sale',
        amountPaise: net,
        referenceType: 'sale',
        referenceId: saleId,
        referenceNo,
        note: `বিক্রয় ${referenceNo}`,
        userId: input.userId,
        at
      });
      db.prepare(
        `INSERT INTO sale_payments
         (id, business_id, sale_id, amount_paise, payment_method, account_id, reference,
          cheque_no, bank_name, cheque_date, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateId(), input.businessId, saleId, p.amountPaise, p.method, accountId,
        p.reference ?? '', p.chequeNo ?? '', p.bankName ?? '', p.chequeDate ?? null, input.userId, at
      );
      posted += net;
    }

    // Update sale header with cogs + actual paid
    db.prepare('UPDATE sales SET cogs_paise = ?, paid_paise = ? WHERE id = ?')
      .run(cogs, posted, saleId);

    // Customer receivable (credit portion)
    if (customerId && pay.due > 0) {
      postCustomerLedger(db, input.businessId, customerId, {
        type: 'sale',
        amountPaise: pay.due,
        referenceType: 'sale',
        referenceId: saleId,
        referenceNo,
        note: `উজড় বিক্রয় ${referenceNo}`,
        userId: input.userId,
        at
      });
    }

    recordAudit(db, {
      businessId: input.businessId,
      userId: input.userId,
      action: 'sale.create',
      entityType: 'sale',
      entityId: saleId,
      after: {
        referenceNo, total: totals.total, paid: posted, due: pay.due, change: pay.change,
        lines: lines.length, customer: customerId
      },
      at
    });
  });

  return {
    saleId,
    referenceNo,
    subtotalPaise: totals.subtotal,
    discountPaise: totals.discount,
    taxPaise: totals.tax,
    totalPaise: totals.total,
    paidPaise: pay.received < totals.total ? pay.received : totals.total,
    duePaise: pay.due,
    changePaise: pay.change,
    cogsPaise: cogs,
    grossProfitPaise: totals.total - cogs,
    lines: lines.map((l) => ({
      productId: l.input.productId,
      productName: l.productName,
      quantity: l.qty,
      unitPricePaise: l.unitPricePaise,
      discountPaise: l.discountPaise + l.orderDiscountPaise,
      taxPaise: l.taxPaise,
      lineTotalPaise: l.netPaise,
      cogsPaise: l.cogsPaise
    })),
    status: pay.due > 0 ? 'partially_paid' : 'paid'
  };
}

function checkExpiredBatches(db: DB, productId: string, fin: ReturnType<typeof getFinancialSettings>) {
  const product = getProduct(db, productId);
  if (!product || !product.expiry_enabled) return { blocked: false };
  const batches = listActiveBatches(db, product.business_id, productId);
  if (batches.length === 0) return { blocked: false };
  const now = Date.now();
  const hasValid = batches.some((b) => !b.expiry_date || b.expiry_date > now);
  return { blocked: !hasValid };
}

/** Consume stock from batches FEFO (first-expiry-first-out) for batch products. */
function consumeBatches(db: DB, productId: string, qty: number, at: number): void {
  const product = getProduct(db, productId);
  if (!product || !product.batch_enabled) return;
  const batches = listActiveBatches(db, product.business_id, productId);
  if (batches.length === 0) return;
  let remaining = qty;
  for (const b of batches) {
    if (remaining <= QTY_EPS) break;
    const take = Math.min(b.quantity, remaining);
    adjustBatchQuantity(db, b.id, -take);
    remaining = roundQty(remaining - take);
  }
  void at;
}

// ---------------- Customer receivable funnel (shared by returns too) ----------------

export interface CustomerLedgerPost {
  /** 'sale' (due +) | 'payment' (due −) | 'sale_return' (due −) | 'adjustment' */
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

/** Update the customer's receivable + ledger row. Must run in a transaction. */
export function postCustomerLedger(
  db: DB,
  businessId: string,
  customerId: string,
  entry: CustomerLedgerPost
): void {
  const cust = db
    .prepare('SELECT id, due_balance_paise FROM customers WHERE id = ? AND business_id = ?')
    .get(customerId, businessId) as { id: string; due_balance_paise: number } | undefined;
  if (!cust) throw new NotFoundError('কাস্টমার', customerId);
  const delta = entry.type === 'sale' || entry.type === 'adjustment' ? entry.amountPaise : -entry.amountPaise;
  const newDue = cust.due_balance_paise + delta;
  if (newDue < 0) {
    throw new ValidationError('বকেয়া ঋণাত্মক হতে পারে না — অতিরিক্ত পেমেন্ট বাদ দিন বা অগ্রিম হিসাবে নিন।');
  }
  db.prepare(
    `INSERT INTO customer_transactions
     (id, business_id, customer_id, transaction_type, amount_paise, reference_type, reference_id,
      reference_no, payment_method, account_id, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(
    generateId(), businessId, customerId, entry.type, entry.amountPaise,
    entry.referenceType ?? null, entry.referenceId ?? null, entry.referenceNo ?? null,
    entry.paymentMethod ?? null, entry.note ?? '', entry.userId ?? null, entry.at ?? Date.now()
  );
  db.prepare('UPDATE customers SET due_balance_paise = ?, updated_at = ? WHERE id = ?')
    .run(newDue, Date.now(), customerId);
}

// ---------------- Lookups ----------------

export interface SaleRecord {
  id: string;
  business_id: string;
  customer_id: string | null;
  reference_no: string;
  date: number;
  subtotal_paise: number;
  discount_paise: number;
  tax_paise: number;
  total_paise: number;
  paid_paise: number;
  due_paise: number;
  cogs_paise: number;
  status: string;
  note: string;
  user_id: string | null;
  created_at: number;
  updated_at: number;
  customer_name?: string | null;
  user_name?: string | null;
}

export interface SaleItemRecord {
  id: string;
  sale_id: string;
  product_id: string;
  product_name_snapshot: string;
  sku_snapshot: string;
  barcode_snapshot: string;
  unit_id: string | null;
  quantity: number;
  unit_price_paise: number;
  discount_paise: number;
  tax_paise: number;
  line_total_paise: number;
  cogs_paise: number;
}

export interface SalePaymentRecord {
  id: string;
  sale_id: string;
  amount_paise: number;
  payment_method: string;
  account_id: string | null;
  reference: string;
  user_id: string | null;
  created_at: number;
}

export function getSale(db: DB, businessId: string, idOrRef: string): (SaleRecord & {
  items: SaleItemRecord[];
  payments: SalePaymentRecord[];
}) | undefined {
  const sale = db
    .prepare(
      `SELECT s.*, c.name AS customer_name, u.name AS user_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.business_id = ? AND (s.id = ? OR s.reference_no = ?)`
    )
    .get(businessId, idOrRef, idOrRef) as SaleRecord | undefined;
  if (!sale) return undefined;
  const items = db
    .prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY rowid')
    .all(sale.id) as SaleItemRecord[];
  const payments = db
    .prepare('SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY created_at')
    .all(sale.id) as SalePaymentRecord[];
  return { ...sale, items, payments };
}

export function querySales(
  db: DB,
  q: { businessId: string; from?: number; to?: number; customerId?: string; status?: string; search?: string; limit?: number; offset?: number }
) {
  const where = ['s.business_id = ?'];
  const params: unknown[] = [q.businessId];
  if (q.from !== undefined) { where.push('s.date >= ?'); params.push(q.from); }
  if (q.to !== undefined) { where.push('s.date <= ?'); params.push(q.to); }
  if (q.customerId) { where.push('s.customer_id = ?'); params.push(q.customerId); }
  if (q.status) { where.push('s.status = ?'); params.push(q.status); }
  if (q.search) { where.push('(s.reference_no LIKE ? OR c.name LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`); }
  const limit = Math.min(q.limit ?? 50, 500);
  const rows = db
    .prepare(
      `SELECT s.*, c.name AS customer_name, u.name AS user_name,
              (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.date DESC, s.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, q.offset ?? 0) as Record<string, unknown>[];
  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE ${where.join(' AND ')}`
    )
    .get(...params) as { c: number };
  return { rows, total: total.c };
}

// ---------------- Void ----------------

export function voidSale(db: DB, input: { businessId: string; saleId: string; userId: string; reason?: string }): void {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ? AND business_id = ?').get(input.saleId, input.businessId) as
    | SaleRecord
    | undefined;
  if (!sale) throw new NotFoundError('বিক্রয়', input.saleId);
  if (sale.status === 'voided') throw new ConflictError('এই বিক্রয়টি ইতিমধ্যে বিলগা করা হয়েছে।');

  tx(db, () => {
    // Restock items
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(input.saleId) as
      { product_id: string; quantity: number; cogs_paise: number }[];
    for (const it of items) {
      receive(db, {
        businessId: input.businessId,
        productId: it.product_id,
        quantity: it.quantity,
        unitCostPaise: Math.round(it.cogs_paise / Math.max(it.quantity, QTY_EPS)),
        movementType: 'sale_void',
        referenceType: 'sale',
        referenceId: input.saleId,
        userId: input.userId,
        reason: 'বিলগা',
        at: Date.now()
      });
      consumeBatchesReverse(db, it.product_id, it.quantity);
    }

    // Reverse account postings (change was never posted — subtract it once)
    const payments = db
      .prepare('SELECT sp.*, a.id AS account_id FROM sale_payments sp LEFT JOIN accounts a ON a.id = sp.account_id WHERE sp.sale_id = ? ORDER BY sp.created_at, sp.id')
      .all(input.saleId) as { amount_paise: number; payment_method: string; account_id: string | null }[];
    const totalP = sale.total_paise as number;
    const paidP = payments.filter((x) => x.account_id).reduce((s, x) => s + x.amount_paise, 0);
    const changeP = Math.max(0, paidP - totalP);
    let voidChangeApplied = false;
    for (const p of payments) {
      if (!p.account_id) continue;
      let net = p.amount_paise;
      if (p.payment_method === 'cash' && changeP > 0 && !voidChangeApplied) {
        net -= changeP;
        voidChangeApplied = true;
      }
      if (net <= 0) continue;
      post(db, {
        businessId: input.businessId,
        accountId: p.account_id,
        type: 'sale_refund',
        amountPaise: -net,
        referenceType: 'sale',
        referenceId: input.saleId,
        referenceNo: sale.reference_no as string,
        note: 'বিলগা — বিক্রয় ফেরত',
        userId: input.userId
      });
    }

    // Reverse customer receivable
    if (sale.customer_id && (sale.due_paise as number) > 0) {
      postCustomerLedger(db, input.businessId, sale.customer_id as string, {
        type: 'sale_return',
        amountPaise: sale.due_paise as number,
        referenceType: 'sale',
        referenceId: input.saleId,
        referenceNo: sale.reference_no as string,
        note: 'বিলগা — বকেয়া বাতিল',
        userId: input.userId
      });
    }

    db.prepare("UPDATE sales SET status = 'voided', updated_at = ? WHERE id = ?").run(Date.now(), input.saleId);
    recordAudit(db, {
      businessId: input.businessId,
      userId: input.userId,
      action: 'sale.void',
      entityType: 'sale',
      entityId: input.saleId,
      before: { referenceNo: sale.reference_no, status: sale.status },
      after: { status: 'voided', reason: input.reason ?? '' },
      meta: { reason: input.reason ?? '' }
    });
  });
}

function consumeBatchesReverse(db: DB, productId: string, qty: number): void {
  const product = getProduct(db, productId);
  if (!product || !product.batch_enabled) return;
  // On void, restore to the batch consumed most recently is not tracked per sale;
  // restore to the oldest active batch (documented approximation).
  const batches = listActiveBatches(db, product.business_id, productId);
  if (batches.length === 0) return;
  const first = batches[0];
  adjustBatchQuantity(db, first.id, qty);
}

// ---------------- Held carts (§23) ----------------

export interface HeldCart {
  id: string;
  label: string;
  items: SaleLineInput[];
  customerId: string | null;
  createdAt: number;
}

export function holdSale(
  db: DB,
  input: { businessId: string; userId: string; label?: string; items: SaleLineInput[]; customerId?: string | null }
): string {
  if (input.items.length === 0) throw new ValidationError('খালি কার্ট হোল্ড করা যায় না।');
  const id = generateId();
  db.prepare(
    `INSERT INTO held_carts (id, business_id, user_id, label, items_json, customer_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'held', ?)`
  ).run(id, input.businessId, input.userId, input.label ?? '', JSON.stringify(input.items), input.customerId ?? null, Date.now());
  return id;
}

export function listHeldCarts(db: DB, businessId: string, userId?: string): HeldCart[] {
  const rows = userId
    ? db
        .prepare("SELECT * FROM held_carts WHERE business_id = ? AND user_id = ? AND status = 'held' ORDER BY created_at DESC")
        .all(businessId, userId)
    : db
        .prepare("SELECT * FROM held_carts WHERE business_id = ? AND status = 'held' ORDER BY created_at DESC")
        .all(businessId);
  return (rows as { id: string; label: string; items_json: string; customer_id: string | null; created_at: number }[]).map(
    (r) => ({
      id: r.id,
      label: r.label,
      items: JSON.parse(r.items_json) as SaleLineInput[],
      customerId: r.customer_id,
      createdAt: r.created_at
    })
  );
}

export function resumeHeldSale(db: DB, businessId: string, id: string): HeldCart | null {
  const row = db
    .prepare("SELECT * FROM held_carts WHERE id = ? AND business_id = ? AND status = 'held'")
    .get(id, businessId) as
    | { id: string; label: string; items_json: string; customer_id: string | null; created_at: number }
    | undefined;
  if (!row) return null;
  db.prepare("UPDATE held_carts SET status = 'resumed' WHERE id = ?").run(id);
  return {
    id: row.id,
    label: row.label,
    items: JSON.parse(row.items_json) as SaleLineInput[],
    customerId: row.customer_id,
    createdAt: row.created_at
  };
}

export function cancelHeldSale(db: DB, businessId: string, id: string): void {
  db.prepare("UPDATE held_carts SET status = 'cancelled' WHERE id = ? AND business_id = ?").run(id, businessId);
}

export { findProductByBarcode };
