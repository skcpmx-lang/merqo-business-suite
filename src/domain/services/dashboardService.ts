/**
 * Dashboard service (§12–§14) — flagship executive KPIs + trends.
 * Every number comes from the same report queries used by the report
 * screens (§120).
 */
import type { DB } from '../db/connection';
import { resolveRange } from '../../shared/dates';
import { createReports, type Range } from './reportService';
import { mfsSummary } from './mfsService';

export interface DashboardData {
  range: Range;
  prevRange: Range;
  kpis: {
    todaySales: number;
    todayPurchases: number;
    todayProfit: number;
    todayExpenses: number;
    todayCollections: number;
    customerDue: number;
    supplierPayable: number;
    stockValue: number;
    cashBalance: number;
    bankBalance: number;
    mfsBalance: number;
  };
  kpiDeltas: {
    sales: number;
    profit: number;
  };
  salesTrend: { day: string; label: number; total: number }[];
  profitTrend: { day: string; label: number; gross: number; net: number }[];
  purchaseTrend: { day: string; label: number; total: number }[];
  expenseTrend: { day: string; label: number; total: number }[];
  paymentMix: { method: string; total: number }[];
  topProducts: { id: string; name: string; qty: number; revenue: number; profit: number }[];
  lowStock: { id: string; name: string; quantity: number; reorder_level: number }[];
  outOfStock: { id: string; name: string }[];
  topCustomerDues: { id: string; name: string; phone: string; due_balance_paise: number }[];
  topSupplierPayables: { id: string; name: string; phone: string; payable_balance_paise: number }[];
  cashFlow: { day: string; label: number; inflow: number; outflow: number }[];
  mfsSummary: Record<string, unknown>[];
  categoryMix: { category: string; revenue: number }[];
}

export function getDashboard(db: DB, businessId: string, preset: string, now = Date.now()): DashboardData {
  const reports = createReports(db);
  const range = resolveRange(preset as never, now);
  // previous period of equal length
  const len = range.to - range.from;
  const prevRange: Range = { from: range.from - len - 1, to: range.from - 1 };

  const s = reports.salesSummary(businessId, range);
  const ps = reports.salesSummary(businessId, prevRange);
  const p = reports.profitAndLoss(businessId, range);
  const pp = reports.profitAndLoss(businessId, prevRange);
  const stock = reports.stockSummary(businessId);
  const accounts = reports.accountBalanceSheet(businessId);
  const rp = reports.receivablePayable(businessId);

  const cashBalance = accounts.find((a) => a.kind === 'cash')?.balance_paise ?? 0;
  const bankBalance = accounts.find((a) => a.kind === 'bank')?.balance_paise ?? 0;
  const mfsBalance = accounts.filter((a) => a.kind === 'mfs').reduce((sum, a) => sum + a.balance_paise, 0);

  // Today KPIs (independent of the selected range)
  const today = resolveRange('today', now);
  const tSales = reports.salesSummary(businessId, today);
  const tPurchases = reports.purchaseSummary(businessId, today);
  const tExpenses = reports.expensesByCategory(businessId, today).reduce((sum, e) => sum + e.total, 0);
  const tCollections = reports
    .collectionsByDay(businessId, today)
    .reduce((sum, c) => sum + c.total, 0);
  const tProfit = reports.profitAndLoss(businessId, today);

  // Trends
  const salesRows = reports.salesByDay(businessId, range, 'day');
  const salesTrend = reports.fillDayBuckets(salesRows.map((x) => ({ day: x.bucket, total: x.total })), range);
  const salesByDayMap = new Map(salesRows.map((x) => [x.bucket, x]));
  const profitTrend = salesTrend.map((d) => {
    const row = salesByDayMap.get(d.day);
    const gross = (row?.total ?? 0) - (row?.cogs ?? 0);
    return { ...d, gross, net: gross };
  });
  const purchaseTrend = reports.fillDayBuckets(
    reports.all(
      `SELECT strftime('%Y-%m-%d', datetime(date/1000, 'unixepoch')) AS day,
              COALESCE(SUM(total_paise), 0) AS total FROM purchases
       WHERE business_id = ? AND date >= ? AND date <= ? GROUP BY 1 ORDER BY 1`,
      businessId, range.from, range.to
    ) as { day: string; total: number }[],
    range
  );
  const expenseTrend = reports.fillDayBuckets(
    reports.all(
      `SELECT strftime('%Y-%m-%d', datetime(date/1000, 'unixepoch')) AS day,
              COALESCE(SUM(amount_paise), 0) AS total FROM expenses
       WHERE business_id = ? AND date >= ? AND date <= ? GROUP BY 1 ORDER BY 1`,
      businessId, range.from, range.to
    ) as { day: string; total: number }[],
    range
  );

  const low = reports.all(
    `SELECT p.id, p.name, i.quantity, p.reorder_level FROM products p
     JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
     WHERE p.business_id = ? AND p.status = 'active' AND i.quantity <= p.reorder_level AND p.reorder_level > 0
     ORDER BY (i.quantity / NULLIF(p.reorder_level, 0)) ASC LIMIT 10`,
    businessId
  ) as { id: string; name: string; quantity: number; reorder_level: number }[];
  const oos = reports.all(
    `SELECT p.id, p.name FROM products p
     LEFT JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
     WHERE p.business_id = ? AND p.status = 'active' AND COALESCE(i.quantity, 0) <= 0
     ORDER BY p.name LIMIT 10`,
    businessId
  ) as { id: string; name: string }[];

  return {
    range,
    prevRange,
    kpis: {
      todaySales: tSales.net_sales,
      todayPurchases: tPurchases.total,
      todayProfit: tProfit.netProfit,
      todayExpenses: tExpenses,
      todayCollections: tCollections,
      customerDue: rp.receivable,
      supplierPayable: rp.payable,
      stockValue: stock.stock_value ?? 0,
      cashBalance,
      bankBalance,
      mfsBalance
    },
    kpiDeltas: {
      sales: s.net_sales - ps.net_sales,
      profit: p.netProfit - pp.netProfit
    },
    salesTrend,
    profitTrend,
    purchaseTrend,
    expenseTrend,
    paymentMix: reports.salesByPaymentMethod(businessId, range) as { method: string; total: number }[],
    topProducts: reports.salesByProduct(businessId, range, 8) as { id: string; name: string; qty: number; revenue: number; profit: number }[],
    lowStock: low,
    outOfStock: oos,
    topCustomerDues: reports.topCustomerDues(businessId, 8),
    topSupplierPayables: reports.topSupplierPayables(businessId, 8),
    cashFlow: reports.cashFlowByDay(businessId, range),
    mfsSummary: mfsSummary(db, businessId, range.from, range.to),
    categoryMix: reports.salesByCategory(businessId, range) as { category: string; revenue: number }[]
  };
}
