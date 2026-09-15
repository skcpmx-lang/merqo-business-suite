/**
 * Performance at scale (RC: 10k+ dataset).
 *
 * Seeds 10,000 products (bulk) + 2,000 real domain sales, then asserts the
 * read paths a shop actually uses stay fast. Time budgets are deliberately
 * generous — the point is to catch quadratic blowups, not micro-tune.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeEnv, type TestEnv } from '../helpers';
import { generateId } from '../../src/shared/ids';
import { createSale } from '../../src/domain/services/saleService';
import { queryProducts } from '../../src/domain/repos/master';
import { querySales } from '../../src/domain/services/saleService';
import { getDashboard } from '../../src/domain/services/dashboardService';
import { createReports } from '../../src/domain/services/reportService';
import { globalSearch } from '../../src/domain/services/searchService';
import { listAccounts, recomputedBalance } from '../../src/domain/services/accountService';
import { reconcileInventory } from '../../src/domain/services/inventoryService';
import { tx } from '../../src/domain/db/connection';

let env: TestEnv;
const PRODUCT_COUNT = 10000;
const SALE_COUNT = 2000;
const now = Date.now();

function timed(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

beforeAll(() => {
  env = makeEnv({ openingCash: 1000000000 });
  const { db, businessId, adminUserId, unitId, categoryId } = env;

  // bulk-seed products + stock (one transaction: fast and honest — the
  // read paths under test join these tables)
  tx(db, () => {
    const insP = db.prepare(
      `INSERT INTO products (id, business_id, name, sku, category_id, brand_id, unit_id,
        purchase_price_paise, selling_price_paise, min_selling_price_paise,
        promotional_price_paise, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 10000, 15000, 0, NULL, 'active', ?, ?)`
    );
    const insI = db.prepare(
      `INSERT INTO inventory (id, business_id, product_id, quantity, avg_cost_paise, updated_at)
       VALUES (?, ?, ?, 100, 10000, ?)`
    );
    const insM = db.prepare(
      `INSERT INTO inventory_movements
       (id, business_id, product_id, batch_id, movement_type, quantity, unit_cost_paise,
        reference_type, reference_id, reason, note, user_id, created_at)
       VALUES (?, ?, ?, NULL, 'opening_stock', 100, 10000, NULL, NULL, 'প্রাথমিক স্টক', '', ?, ?)`
    );
    for (let i = 1; i <= PRODUCT_COUNT; i++) {
      const id = generateId();
      insP.run(id, businessId, `বাল্ক পণ্য ${i}`, `BULK-${i}`, categoryId, unitId, now, now);
      insI.run(generateId(), businessId, id, now);
      insM.run(generateId(), businessId, id, adminUserId, now);
    }
  });

  // real domain sales round-robin over the product set
  const products = db.prepare('SELECT id FROM products WHERE business_id = ? ORDER BY id').all(businessId) as { id: string }[];
  for (let i = 0; i < SALE_COUNT; i++) {
    const at = now - (SALE_COUNT - i) * 60_000; // spread over ~33 hours
    createSale(db, {
      businessId,
      userId: adminUserId,
      lines: [
        { productId: products[i % products.length].id, quantity: 1 },
        { productId: products[(i * 7 + 3) % products.length].id, quantity: 1 }
      ],
      payments: [{ method: 'cash', amountPaise: 30000 }],
      at
    });
  }
});
afterAll(() => env.close());

describe('10k+ dataset performance', () => {
  it('product list query stays fast', () => {
    const ms = timed(() => queryProducts(env.db, { businessId: env.businessId, limit: 50, offset: 0 }));
    expect(ms).toBeLessThan(1000);
  });

  it('sales list query stays fast', () => {
    const ms = timed(() => querySales(env.db, { businessId: env.businessId, limit: 50, offset: 0 } as never));
    expect(ms).toBeLessThan(1000);
  });

  it('global search over 10k products stays fast', () => {
    const ms = timed(() => globalSearch(env.db, env.businessId, 'বাল্ক'));
    expect(ms).toBeLessThan(2000);
  });

  it('dashboard over 2k sales stays fast', () => {
    const ms = timed(() => getDashboard(env.db, env.businessId, 'today'));
    expect(ms).toBeLessThan(2000);
  });

  it('sales summary report over 2k sales stays fast', () => {
    const ms = timed(() => {
      createReports(env.db).salesSummary(env.businessId, { from: now - 90 * 86_400_000, to: now });
    });
    expect(ms).toBeLessThan(2000);
  });

  it('data is still consistent at scale', () => {
    // every account recomputes to its stored balance
    for (const acc of listAccounts(env.db, env.businessId)) {
      const a = acc as unknown as { id: string; balance_paise: number };
      expect(recomputedBalance(env.db, a.id), a.id).toBe(a.balance_paise);
    }
    // stock == movements
    expect(reconcileInventory(env.db, env.businessId).ok).toBe(true);
  });
});
