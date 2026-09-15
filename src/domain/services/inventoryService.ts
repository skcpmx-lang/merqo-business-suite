/**
 * Inventory service — the single authority on stock quantities and
 * weighted-average cost (§28). Every stock change in the application goes
 * through these functions, inside the caller's transaction.
 *
 *  - receive(): purchase / opening stock / sales-return restock increase stock
 *  - issue(): sale decreases stock, returns COGS at current average cost
 *  - restock(): reverses an issue (sale return) at the original issue cost
 *  - adjust(): audited manual adjustments (damage, expiry, correction)
 *
 * Weighted average cost:
 *   newAvg = round((qty * avgCost + inQty * inCost) / (qty + inQty))
 * Costing is consistent across the whole product: profit always uses the
 * same method (§28).
 */
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { getProduct } from '../repos/master';
import { allocateReference } from '../repos/sequences';
import { formatReference, REF_PREFIX } from '../../shared/refs';
import { NotFoundError, InsufficientStockError, ValidationError } from '../errors';

export const QTY_EPS = 0.00001;
export function roundQty(q: number): number {
  return Math.round(q * 10000) / 10000;
}

export function getStock(db: DB, businessId: string, productId: string): { quantity: number; avgCostPaise: number } {
  const row = db
    .prepare('SELECT quantity, avg_cost_paise FROM inventory WHERE business_id = ? AND product_id = ?')
    .get(businessId, productId) as { quantity: number; avg_cost_paise: number } | undefined;
  return { quantity: row?.quantity ?? 0, avgCostPaise: row?.avg_cost_paise ?? 0 };
}

function upsertStockRow(db: DB, businessId: string, productId: string): void {
  db.prepare(
    `INSERT INTO inventory (id, business_id, product_id, quantity, avg_cost_paise, updated_at)
     VALUES (?, ?, ?, 0, 0, ?)
     ON CONFLICT (business_id, product_id) DO NOTHING`
  ).run(generateId(), businessId, productId, Date.now());
}

export interface MovementInput {
  businessId: string;
  productId: string;
  userId?: string | null;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  note?: string;
  batchId?: string;
  at?: number;
}

export function recordMovement(
  db: DB,
  input: MovementInput & { movementType: string; quantity: number; unitCostPaise: number }
): string {
  const id = generateId();
  db.prepare(
    `INSERT INTO inventory_movements
     (id, business_id, product_id, batch_id, movement_type, quantity, unit_cost_paise,
      reference_type, reference_id, reason, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, input.businessId, input.productId, input.batchId ?? null, input.movementType,
    input.quantity, input.unitCostPaise, input.referenceType ?? null, input.referenceId ?? null,
    input.reason ?? '', input.note ?? '', input.userId ?? null, input.at ?? Date.now()
  );
  return id;
}

/** Increase stock with a new cost layer → recompute weighted average cost. */
export function receive(
  db: DB,
  input: MovementInput & { quantity: number; unitCostPaise: number; movementType?: string; allowNegativeCost?: boolean }
): void {
  const product = getProduct(db, input.productId);
  if (!product) throw new NotFoundError('পণ্য', input.productId);
  const qty = roundQty(input.quantity);
  if (qty <= 0) throw new Error('receive: quantity must be positive');
  const cost = input.unitCostPaise;

  upsertStockRow(db, input.businessId, input.productId);
  const stock = getStock(db, input.businessId, input.productId);
  const newQty = roundQty(stock.quantity + qty);
  let newAvg: number;
  if (stock.quantity <= QTY_EPS) {
    newAvg = cost;
  } else {
    // (qty*avg + inQty*inCost)/(qty+inQty) rounded half-up (floor(x+0.5))
    newAvg = Math.floor((stock.quantity * stock.avgCostPaise + qty * cost) / newQty + 0.5);
  }

  db.prepare('UPDATE inventory SET quantity = ?, avg_cost_paise = ?, updated_at = ? WHERE business_id = ? AND product_id = ?')
    .run(newQty, newAvg, input.at ?? Date.now(), input.businessId, input.productId);

  recordMovement(db, {
    ...input,
    movementType: input.movementType ?? 'purchase',
    quantity: qty,
    unitCostPaise: newAvg
  });
}

export interface IssueResult {
  cogsPaise: number;
  avgCostPaise: number;
}

/**
 * Decrease stock; cost of goods sold is valued at the current weighted
 * average cost. Prevents negative stock unless explicitly configured.
 */
export function issue(
  db: DB,
  input: MovementInput & { quantity: number; movementType?: string; allowNegative?: boolean }
): IssueResult {
  const product = getProduct(db, input.productId);
  if (!product) throw new NotFoundError('পণ্য', input.productId);
  const qty = roundQty(input.quantity);
  if (qty <= 0) throw new Error('issue: quantity must be positive');

  upsertStockRow(db, input.businessId, input.productId);
  const stock = getStock(db, input.businessId, input.productId);

  if (!input.allowNegative && stock.quantity + QTY_EPS < qty) {
    throw new InsufficientStockError(product.name, stock.quantity, qty);
  }

  // avgCostPaise is already in paise → multiply by quantity, round to whole paise
  const cogsPaise = Math.round(stock.avgCostPaise * qty);
  const newQty = roundQty(stock.quantity - qty);
  db.prepare('UPDATE inventory SET quantity = ?, updated_at = ? WHERE business_id = ? AND product_id = ?')
    .run(newQty, input.at ?? Date.now(), input.businessId, input.productId);

  recordMovement(db, {
    ...input,
    movementType: input.movementType ?? 'sale',
    quantity: -qty,
    unitCostPaise: stock.avgCostPaise
  });
  return { cogsPaise, avgCostPaise: stock.avgCostPaise };
}

/**
 * Put stock back (sales return) at the cost at which it was sold, so the
 * weighted average returns to its pre-sale state.
 */
export function restock(
  db: DB,
  input: MovementInput & { quantity: number; unitCostPaise: number; movementType?: string }
): void {
  receive(db, {
    ...input,
    movementType: input.movementType ?? 'sales_return',
    unitCostPaise: input.unitCostPaise
  });
}

export interface AdjustInput extends MovementInput {
  /** 'increase' | 'decrease' | 'damaged' | 'expired' | 'correction' */
  adjustmentType: string;
  quantity: number;
  reason: string;
}

/**
 * Audited manual stock adjustment (§27). Decrease cannot create negative
 * stock. Runs in its own transaction and allocates a real STA-xxxxxx
 * reference (the caller never supplies the reference number).
 */
export function adjustStock(db: DB, input: AdjustInput): { id: string; referenceNo: string } {
  const product = getProduct(db, input.productId);
  if (!product) throw new NotFoundError('পণ্য', input.productId);
  const qty = roundQty(Math.abs(input.quantity));
  if (qty <= 0) throw new ValidationError('পরিমাণ সঠিক নয়।');
  if (!input.reason?.trim()) throw new ValidationError('সমন্বয়ের কারণ লিখুন।');

  const at = input.at ?? Date.now();
  const adjId = generateId();
  let referenceNo = '';

  tx(db, () => {
    const n = allocateReference(db, REF_PREFIX.stockAdjustment);
    referenceNo = formatReference(REF_PREFIX.stockAdjustment, n);

    upsertStockRow(db, input.businessId, input.productId);
    const stock = getStock(db, input.businessId, input.productId);
    const increasing = input.adjustmentType === 'increase' || input.adjustmentType === 'correction';

    let newQty: number;
    if (increasing) {
      newQty = roundQty(stock.quantity + qty);
    } else {
      if (stock.quantity + QTY_EPS < qty) {
        throw new InsufficientStockError(product.name, stock.quantity, qty);
      }
      newQty = roundQty(stock.quantity - qty);
    }

    db.prepare('UPDATE inventory SET quantity = ?, updated_at = ? WHERE business_id = ? AND product_id = ?')
      .run(newQty, at, input.businessId, input.productId);

    db.prepare(
      `INSERT INTO stock_adjustments
       (id, business_id, product_id, reference_no, adjustment_type, quantity, unit_cost_paise, reason, note, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      adjId, input.businessId, input.productId, referenceNo, input.adjustmentType,
      increasing ? qty : -qty, stock.avgCostPaise, input.reason, input.note ?? '', input.userId ?? null,
      at
    );

    // The movement ledger uses one stable type for manual adjustments
    // ('adjustment'); the fine-grained type lives in stock_adjustments,
    // reachable via reference_id.
    recordMovement(db, {
      businessId: input.businessId,
      productId: input.productId,
      userId: input.userId,
      movementType: 'adjustment',
      quantity: increasing ? qty : -qty,
      unitCostPaise: stock.avgCostPaise,
      referenceType: 'stock_adjustment',
      referenceId: adjId,
      reason: input.reason,
      note: input.note,
      at
    });
  });
  return { id: adjId, referenceNo };
}

export function movementHistory(db: DB, businessId: string, productId?: string, limit = 200, offset = 0) {
  const where: string[] = ['m.business_id = ?'];
  const params: unknown[] = [businessId];
  if (productId) {
    where.push('m.product_id = ?');
    params.push(productId);
  }
  const rows = db
    .prepare(
      `SELECT m.*, p.name AS product_name, u.name AS user_name,
              COALESCE(sa.reference_no, s.reference_no, sr.reference_no,
                       pu.reference_no, pr.reference_no) AS reference_no
       FROM inventory_movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN stock_adjustments sa ON sa.id = m.reference_id AND m.reference_type = 'stock_adjustment'
       LEFT JOIN sales s ON s.id = m.reference_id AND m.reference_type = 'sale'
       LEFT JOIN sales_returns sr ON sr.id = m.reference_id AND m.reference_type = 'sales_return'
       LEFT JOIN purchases pu ON pu.id = m.reference_id AND m.reference_type = 'purchase'
       LEFT JOIN purchase_returns pr ON pr.id = m.reference_id AND m.reference_type = 'purchase_return'
       WHERE ${where.join(' AND ')}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Record<string, unknown>[];
  return rows;
}

/** Full stock reconciliation: compare inventory table against movement sums. */
export function reconcileInventory(db: DB, businessId: string): { ok: boolean; mismatches: { productId: string; name: string; actual: number; expected: number }[] } {
  const rows = db
    .prepare(
      `SELECT i.product_id, p.name, i.quantity AS actual,
         COALESCE((SELECT SUM(quantity) FROM inventory_movements m
                   WHERE m.product_id = i.product_id AND m.business_id = ?), 0) AS expected
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       WHERE i.business_id = ?
       UNION ALL
       SELECT m.product_id, p.name, 0 AS actual,
         SUM(m.quantity) AS expected
       FROM inventory_movements m
       JOIN products p ON p.id = m.product_id
       WHERE m.business_id = ? AND m.product_id NOT IN (SELECT product_id FROM inventory WHERE business_id = ?)
       GROUP BY m.product_id
       HAVING ABS(SUM(m.quantity)) > 0.00001`
    )
    .all(businessId, businessId, businessId, businessId) as { product_id: string; name: string; actual: number; expected: number }[];
  const mismatches = rows
    .filter((r) => Math.abs(r.actual - r.expected) > QTY_EPS)
    .map((r) => ({ productId: r.product_id, name: r.name, actual: r.actual, expected: r.expected }));
  return { ok: mismatches.length === 0, mismatches };
}

export function inventorySummary(db: DB, businessId: string) {
  const total = db
    .prepare(
      `SELECT COUNT(*) AS products,
              COALESCE(SUM(i.quantity), 0) AS units,
              COALESCE(SUM(i.quantity * i.avg_cost_paise), 0) AS stock_value_paise,
              COALESCE(SUM(CASE WHEN i.quantity <= 0 THEN 1 ELSE 0 END), 0) AS out_of_stock,
              COALESCE(SUM(CASE WHEN i.quantity > 0 AND i.quantity <= p.reorder_level THEN 1 ELSE 0 END), 0) AS low_stock,
              COALESCE(SUM(CASE WHEN i.quantity > p.reorder_level * 3 AND p.reorder_level > 0 THEN 1 ELSE 0 END), 0) AS overstock
       FROM products p
       LEFT JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
       WHERE p.business_id = ? AND p.status <> 'deleted'`
    )
    .get(businessId) as Record<string, number>;
  return {
    totalProducts: Number(total.products ?? 0),
    totalUnits: Number(total.units ?? 0),
    stockValuePaise: Number(total.stock_value_paise ?? 0),
    outOfStock: Number(total.out_of_stock ?? 0),
    lowStock: Number(total.low_stock ?? 0),
    overstock: Number(total.overstock ?? 0)
  };
}


