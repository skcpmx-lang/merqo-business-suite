import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeEnv, makeProduct, type TestEnv } from '../helpers';
import { globalSearch } from '../../src/domain/services/searchService';
import { createCustomer } from '../../src/domain/services/customerService';
import { createSupplier } from '../../src/domain/services/supplierService';
import { createSale } from '../../src/domain/services/saleService';

let env: TestEnv;

beforeAll(() => {
  env = makeEnv();
});
afterAll(() => env.close());

describe('global search (§11)', () => {
  it('finds products by name, sku, and barcode', () => {
    const p = makeProduct(env, { name: 'মেঘনা ডাল', sku: 'DAL-1', barcode: '8903000001', stock: 10 });
    void p;
    expect(globalSearch(env.db, env.businessId, 'মেঘনা').products[0]?.name).toBe('মেঘনা ডাল');
    expect(globalSearch(env.db, env.businessId, 'DAL-1').products[0]?.sku).toBe('DAL-1');
    expect(globalSearch(env.db, env.businessId, '8903000001').products[0]?.name).toBe('মেঘনা ডাল');
  });

  it('finds customers and suppliers by name/phone', () => {
    createCustomer(env.db, { businessId: env.businessId, name: 'হাসান আহমেদ', phone: '01912345678', userId: env.adminUserId });
    createSupplier(env.db, { businessId: env.businessId, name: 'পদ্মা ডেলিভারি', phone: '027777777', userId: env.adminUserId });
    expect(globalSearch(env.db, env.businessId, 'হাসান').customers[0]?.name).toBe('হাসান আহমেদ');
    expect(globalSearch(env.db, env.businessId, '01912345678').customers[0]?.name).toBe('হাসান আহমেদ');
    expect(globalSearch(env.db, env.businessId, 'পদ্মা').suppliers[0]?.name).toBe('পদ্মা ডেলিভারি');
  });

  it('finds sales by reference number', () => {
    const p = makeProduct(env, { name: 'বিরিয়ানি', sku: 'BIR-1', stock: 5, cost: 30000, price: 50000 });
    createSale(env.db, {
      businessId: env.businessId, userId: env.adminUserId,
      lines: [{ productId: p, quantity: 1 }],
      payments: [{ method: 'cash', amountPaise: 50000 }]
    });
    const found = globalSearch(env.db, env.businessId, 'INV-000001').sales;
    expect(found).toHaveLength(1);
    expect(found[0].reference_no).toBe('INV-000001');
  });

  it('empty term returns empty results', () => {
    const r = globalSearch(env.db, env.businessId, '   ');
    expect(r.products).toHaveLength(0);
    expect(r.customers).toHaveLength(0);
  });
});
