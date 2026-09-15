/**
 * Reporting engine (§46, §120).
 *
 * Dashboard KPIs and detailed reports all call the same query functions —
 * totals reconcile by construction. Every report accepts the standard
 * date-range shape used across the app (§47).
 */
import type { DB } from '../db/connection';
import { dayKey, startOfDayLocal, endOfDayLocal, addDaysLocal } from '../../shared/dates';

export interface Range {
  from: number;
  to: number;
}

export class Reports {
  constructor(private db: DB) {}

  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  // ============ SALES ============

  salesSummary(businessId: string, r: Range) {
    return this.one(
      `SELECT
         COALESCE(SUM(CASE WHEN status <> 'voided' THEN total_paise ELSE 0 END), 0) AS net_sales,
         COALESCE(SUM(CASE WHEN status <> 'voided' THEN discount_paise ELSE 0 END), 0) AS discounts,
         COALESCE(SUM(CASE WHEN status <> 'voided' THEN tax_paise ELSE 0 END), 0) AS tax,
         COALESCE(SUM(CASE WHEN status <> 'voided' THEN cogs_paise ELSE 0 END), 0) AS cogs,
         COALESCE(SUM(CASE WHEN status <> 'voided' THEN due_paise ELSE 0 END), 0) AS credit_created,
         COALESCE(SUM(CASE WHEN status <> 'voided' THEN paid_paise ELSE 0 END), 0) AS received,
         COUNT(*) AS sale_count,
         COALESCE((SELECT SUM(total_paise) FROM sales_returns WHERE business_id = ? AND date >= ? AND date <= ? AND status <> 'voided'), 0) AS returns
       FROM sales WHERE business_id = ? AND date >= ? AND date <= ?`,
      businessId, r.from, r.to, businessId, r.from, r.to
    ) as {
      net_sales: number; discounts: number; tax: number; cogs: number;
      credit_created: number; received: number; sale_count: number; returns: number;
    };
  }

  salesByDay(businessId: string, r: Range, step: 'day' | 'week' | 'month' = 'day') {
    const groupExpr =
      step === 'day'
        ? "strftime('%Y-%m-%d', datetime(date/1000, 'unixepoch'))"
        : step === 'week'
          ? "strftime('%Y-W%W', datetime(date/1000, 'unixepoch'))"
          : "strftime('%Y-%m', datetime(date/1000, 'unixepoch'))";
    return this.all(
      `SELECT ${groupExpr} AS bucket,
              COALESCE(SUM(CASE WHEN status <> 'voided' THEN total_paise ELSE 0 END), 0) AS total,
              COALESCE(SUM(CASE WHEN status <> 'voided' THEN cogs_paise ELSE 0 END), 0) AS cogs,
              COUNT(CASE WHEN status <> 'voided' THEN 1 END) AS count
       FROM sales WHERE business_id = ? AND date >= ? AND date <= ?
       GROUP BY 1 ORDER BY 1`,
      businessId, r.from, r.to
    ) as { bucket: string; total: number; cogs: number; count: number }[];
  }

  salesByPaymentMethod(businessId: string, r: Range) {
    return this.all(
      `SELECT sp.payment_method AS method, COALESCE(SUM(sp.amount_paise), 0) AS total, COUNT(*) AS count
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
       WHERE s.business_id = ? AND s.date >= ? AND s.date <= ? AND s.status <> 'voided'
       GROUP BY sp.payment_method ORDER BY total DESC`,
      businessId, r.from, r.to
    );
  }

  salesByProduct(businessId: string, r: Range, limit = 100) {
    return this.all(
      `SELECT si.product_id, si.product_name_snapshot AS name,
              COALESCE(SUM(si.quantity), 0) AS qty,
              COALESCE(SUM(si.line_total_paise), 0) AS revenue,
              COALESCE(SUM(si.cogs_paise), 0) AS cogs,
              COALESCE(SUM(si.line_total_paise - si.cogs_paise), 0) AS profit
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.business_id = ? AND s.date >= ? AND s.date <= ? AND s.status <> 'voided'
       GROUP BY si.product_id ORDER BY revenue DESC LIMIT ?`,
      businessId, r.from, r.to, limit
    );
  }

  salesByCategory(businessId: string, r: Range) {
    return this.all(
      `SELECT COALESCE(c.name, 'অন্যান্য') AS category,
              COALESCE(SUM(si.quantity), 0) AS qty,
              COALESCE(SUM(si.line_total_paise), 0) AS revenue,
              COALESCE(SUM(si.line_total_paise - si.cogs_paise), 0) AS profit
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN product_categories c ON c.id = p.category_id
       WHERE s.business_id = ? AND s.date >= ? AND s.date <= ? AND s.status <> 'voided'
       GROUP BY c.id, c.name ORDER BY revenue DESC`,
      businessId, r.from, r.to
    );
  }

  salesByCustomer(businessId: string, r: Range) {
    return this.all(
      `SELECT COALESCE(c.id, 'walkin') AS customer_id, COALESCE(c.name, 'সাধারণ কাস্টমার') AS name,
              COUNT(*) AS count,
              COALESCE(SUM(s.total_paise), 0) AS revenue,
              COALESCE(SUM(s.due_paise), 0) AS credit
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.business_id = ? AND s.date >= ? AND s.date <= ? AND s.status <> 'voided'
       GROUP BY c.id ORDER BY revenue DESC LIMIT 200`,
      businessId, r.from, r.to
    );
  }

  salesByCashier(businessId: string, r: Range) {
    return this.all(
      `SELECT COALESCE(u.name, '—') AS cashier, COUNT(*) AS count,
              COALESCE(SUM(s.total_paise), 0) AS revenue,
              COALESCE(SUM(s.total_paise - s.cogs_paise), 0) AS gross_profit
       FROM sales s LEFT JOIN users u ON u.id = s.user_id
       WHERE s.business_id = ? AND s.date >= ? AND s.date <= ? AND s.status <> 'voided'
       GROUP BY u.id ORDER BY revenue DESC`,
      businessId, r.from, r.to
    );
  }

  // ============ PURCHASES ============

  purchaseSummary(businessId: string, r: Range) {
    return this.one(
      `SELECT
         COALESCE(SUM(total_paise), 0) AS total,
         COALESCE(SUM(paid_paise), 0) AS paid,
         COALESCE(SUM(due_paise), 0) AS due,
         COUNT(*) AS purchase_count,
         COALESCE((SELECT SUM(total_paise) FROM purchase_returns WHERE business_id = ? AND date >= ? AND date <= ? AND status <> 'voided'), 0) AS returns
       FROM purchases WHERE business_id = ? AND date >= ? AND date <= ?`,
      businessId, r.from, r.to, businessId, r.from, r.to
    ) as { total: number; paid: number; due: number; purchase_count: number; returns: number };
  }

  purchasesBySupplier(businessId: string, r: Range) {
    return this.all(
      `SELECT s.name AS supplier, COUNT(*) AS count, COALESCE(SUM(p.total_paise), 0) AS total,
              COALESCE(SUM(p.due_paise), 0) AS due
       FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.business_id = ? AND p.date >= ? AND p.date <= ?
       GROUP BY s.id ORDER BY total DESC`,
      businessId, r.from, r.to
    );
  }

  purchasesByProduct(businessId: string, r: Range, limit = 100) {
    return this.all(
      `SELECT pi.product_id, pi.product_name_snapshot AS name,
              COALESCE(SUM(pi.quantity), 0) AS qty,
              COALESCE(SUM(pi.line_total_paise), 0) AS cost
       FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
       WHERE p.business_id = ? AND p.date >= ? AND p.date <= ?
       GROUP BY pi.product_id ORDER BY cost DESC LIMIT ?`,
      businessId, r.from, r.to, limit
    );
  }

  // ============ INVENTORY ============

  stockSummary(businessId: string) {
    return this.one(
      `SELECT COUNT(*) AS products,
              COALESCE(SUM(i.quantity), 0) AS units,
              COALESCE(SUM(i.quantity * i.avg_cost_paise), 0) AS stock_value,
              COALESCE(SUM(CASE WHEN COALESCE(i.quantity, 0) <= 0 THEN 1 ELSE 0 END), 0) AS out_of_stock,
              COALESCE(SUM(CASE WHEN i.quantity > 0 AND i.quantity <= p.reorder_level AND p.reorder_level > 0 THEN 1 ELSE 0 END), 0) AS low_stock,
              COALESCE(SUM(CASE WHEN p.reorder_level > 0 AND i.quantity > p.reorder_level * 3 THEN 1 ELSE 0 END), 0) AS overstock
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
       WHERE p.business_id = ? AND p.status <> 'deleted'`,
      businessId
    ) as Record<string, number>;
  }

  topStockValue(businessId: string, limit = 20) {
    return this.all(
      `SELECT p.id, p.name, i.quantity, i.avg_cost_paise, (i.quantity * i.avg_cost_paise) AS value
       FROM products p JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
       WHERE p.business_id = ? AND p.status <> 'deleted'
       ORDER BY value DESC LIMIT ?`,
      businessId, limit
    );
  }

  deadStock(businessId: string, days = 90) {
    const cutoff = Date.now() - days * 86400000;
    return this.all(
      `SELECT p.id, p.name, i.quantity, (i.quantity * i.avg_cost_paise) AS value
       FROM products p JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
       WHERE p.business_id = ? AND p.status <> 'deleted' AND i.quantity > 0
         AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = p.id AND m.movement_type = 'sale' AND m.created_at >= ?)
       ORDER BY value DESC LIMIT 200`,
      businessId, cutoff
    );
  }

  fastMoving(businessId: string, r: Range, limit = 20) {
    return this.salesByProduct(businessId, r, limit);
  }

  slowMoving(businessId: string, r: Range, limit = 20) {
    const cutoff = r.to - 30 * 86400000;
    return this.all(
      `SELECT p.id, p.name, COALESCE(i.quantity, 0) AS quantity,
              COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                        WHERE si.product_id = p.id AND s.date >= ? AND s.date <= ? AND s.status <> 'voided'), 0) AS sold_recent
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
       WHERE p.business_id = ? AND p.status = 'active' AND COALESCE(i.quantity, 0) > 0
       ORDER BY sold_recent ASC, p.name LIMIT ?`,
      cutoff, r.to, businessId, limit
    );
  }

  expiringBatches(businessId: string, days = 30) {
    const now = Date.now();
    const horizon = now + days * 86400000;
    return this.all(
      `SELECT b.id, b.batch_no, b.expiry_date, b.quantity, b.unit_cost_paise,
              p.name AS product_name, s.name AS supplier_name
       FROM product_batches b
       JOIN products p ON p.id = b.product_id
       LEFT JOIN suppliers s ON s.id = b.supplier_id
       WHERE b.business_id = ? AND b.status = 'active' AND b.expiry_date IS NOT NULL AND b.expiry_date <= ?
       ORDER BY b.expiry_date ASC`,
      businessId, horizon
    );
  }

  damagedStock(businessId: string, r: Range) {
    return this.all(
      `SELECT p.id, p.name, COALESCE(SUM(-m.quantity), 0) AS qty, m.created_at AS date
       FROM inventory_movements m JOIN products p ON p.id = m.product_id
       WHERE m.business_id = ? AND m.movement_type IN ('damaged','expired') AND m.created_at >= ? AND m.created_at <= ?
       GROUP BY p.id ORDER BY date DESC`,
      businessId, r.from, r.to
    );
  }

  // ============ FINANCIAL ============

  profitAndLoss(businessId: string, r: Range) {
    const s = this.salesSummary(businessId, r);
    const expensesTotal = (
      this.one(
        'SELECT COALESCE(SUM(amount_paise), 0) AS total FROM expenses WHERE business_id = ? AND date >= ? AND date <= ?',
        businessId, r.from, r.to
      ) as { total: number }
    ).total;
    const netSales = s.net_sales - s.returns;
    const grossProfit = netSales - s.cogs;
    const netProfit = grossProfit - expensesTotal;
    return {
      grossSales: s.net_sales,
      discounts: s.discounts,
      salesReturns: s.returns,
      netSales,
      cogs: s.cogs,
      grossProfit,
      expenses: expensesTotal,
      netProfit
    };
  }

  expensesByCategory(businessId: string, r: Range): { category: string; total: number; count: number }[] {
    return this.all(
      `SELECT c.name AS category, COALESCE(SUM(e.amount_paise), 0) AS total, COUNT(*) AS count
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.business_id = ? AND e.date >= ? AND e.date <= ?
       GROUP BY c.id ORDER BY total DESC`,
      businessId, r.from, r.to
    ) as { category: string; total: number; count: number }[];
  }

  cashFlowByDay(businessId: string, r: Range) {
    const rows = this.all(
      `SELECT ${"strftime('%Y-%m-%d', datetime(t.created_at/1000, 'unixepoch'))"} AS day,
              COALESCE(SUM(CASE WHEN t.amount_paise > 0 THEN t.amount_paise ELSE 0 END), 0) AS inflow,
              COALESCE(SUM(CASE WHEN t.amount_paise < 0 THEN -t.amount_paise ELSE 0 END), 0) AS outflow
       FROM account_transactions t JOIN accounts a ON a.id = t.account_id
       WHERE a.business_id = ? AND t.created_at >= ? AND t.created_at <= ?
       GROUP BY 1 ORDER BY 1`,
      businessId, r.from, r.to
    ) as { day: string; inflow: number; outflow: number }[];
    const map = new Map(rows.map((x) => [x.day, x]));
    const out: { day: string; label: number; inflow: number; outflow: number }[] = [];
    let cursor = startOfDayLocal(r.from);
    const end = endOfDayLocal(r.to);
    let guard = 0;
    while (cursor <= end && guard < 400) {
      const key = dayKey(cursor);
      const row = map.get(key);
      out.push({ day: key, label: cursor, inflow: row?.inflow ?? 0, outflow: row?.outflow ?? 0 });
      cursor = addDaysLocal(cursor, 1);
      guard++;
    }
    return out;
  }

  accountBalanceSheet(businessId: string): { id: string; name: string; kind: string; balance_paise: number; opening_balance_paise: number }[] {
    return this.all(
      `SELECT a.id, a.name, a.kind, a.balance_paise, a.opening_balance_paise
       FROM accounts a WHERE a.business_id = ? AND a.is_active = 1 ORDER BY a.sort`,
      businessId
    ) as { id: string; name: string; kind: string; balance_paise: number; opening_balance_paise: number }[];
  }

  receivablePayable(businessId: string) {
    return this.one(
      `SELECT
         (SELECT COALESCE(SUM(due_balance_paise), 0) FROM customers WHERE business_id = ? AND is_active = 1) AS receivable,
         (SELECT COALESCE(SUM(payable_balance_paise), 0) FROM suppliers WHERE business_id = ? AND is_active = 1) AS payable,
         (SELECT COUNT(*) FROM customers WHERE business_id = ? AND is_active = 1 AND due_balance_paise > 0) AS customers_with_due,
         (SELECT COUNT(*) FROM suppliers WHERE business_id = ? AND is_active = 1 AND payable_balance_paise > 0) AS suppliers_with_payable
       FROM (SELECT 1) x`,
      businessId, businessId, businessId, businessId
    ) as { receivable: number; payable: number; customers_with_due: number; suppliers_with_payable: number };
  }

  topCustomerDues(businessId: string, limit = 10): { id: string; name: string; phone: string; due_balance_paise: number }[] {
    return this.all(
      `SELECT id, name, phone, due_balance_paise FROM customers
       WHERE business_id = ? AND is_active = 1 AND due_balance_paise > 0
       ORDER BY due_balance_paise DESC LIMIT ?`,
      businessId, limit
    ) as { id: string; name: string; phone: string; due_balance_paise: number }[];
  }

  topSupplierPayables(businessId: string, limit = 10): { id: string; name: string; phone: string; payable_balance_paise: number }[] {
    return this.all(
      `SELECT id, name, phone, payable_balance_paise FROM suppliers
       WHERE business_id = ? AND is_active = 1 AND payable_balance_paise > 0
       ORDER BY payable_balance_paise DESC LIMIT ?`,
      businessId, limit
    ) as { id: string; name: string; phone: string; payable_balance_paise: number }[];
  }

  // ============ COLLECTIONS ============

  collectionsByDay(businessId: string, r: Range): { day: string; total: number }[] {
    return this.all(
      `SELECT ${"strftime('%Y-%m-%d', datetime(created_at/1000, 'unixepoch'))"} AS day,
              COALESCE(SUM(amount_paise), 0) AS total
       FROM customer_transactions
       WHERE business_id = ? AND transaction_type = 'payment' AND created_at >= ? AND created_at <= ?
       GROUP BY 1 ORDER BY 1`,
      businessId, r.from, r.to
    ) as { day: string; total: number }[];
  }

  /** Day buckets for a range (fills gaps) — used to align sparse queries. */
  fillDayBuckets<T extends { day: string; total: number }>(rows: T[], r: Range): { day: string; label: number; total: number }[] {
    const map = new Map(rows.map((x) => [x.day, x.total]));
    const out: { day: string; label: number; total: number }[] = [];
    let cursor = startOfDayLocal(r.from);
    const end = endOfDayLocal(r.to);
    let guard = 0;
    while (cursor <= end && guard < 400) {
      const key = dayKey(cursor);
      out.push({ day: key, label: cursor, total: map.get(key) ?? 0 });
      cursor = addDaysLocal(cursor, 1);
      guard++;
    }
    return out;
  }
}

export function createReports(db: DB): Reports {
  return new Reports(db);
}
