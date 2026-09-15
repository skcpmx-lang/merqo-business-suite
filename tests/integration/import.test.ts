import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeEnv, type TestEnv } from '../helpers';
import { parseCsv, previewImport, executeImport, listImportJobs, getImportErrors } from '../../src/domain/services/importService';
import { queryProducts } from '../../src/domain/services/productService';
import { listCustomers } from '../../src/domain/services/customerService';
import { listSuppliers } from '../../src/domain/services/supplierService';

let env: TestEnv;

beforeAll(() => {
  env = makeEnv();
});
afterAll(() => env.close());

const PRODUCTS_CSV = `name,sku,barcode,purchasePrice,sellingPrice,openingStock
চিপস,CHP-1,8902000001,10,15,100
কOLA,CL-1,,8,12,50
,,8902000002,5,10,10
সবুজ পালং,VG-1,8902000001,20,30,0`;

describe('CSV import engine (§49)', () => {
  it('parses CSV with quotes and newlines', () => {
    const rows = parseCsv('a,"b,c",d\n"e""f",g,h\n');
    expect(rows).toEqual([
      ['a', 'b,c', 'd'],
      ['e"f', 'g', 'h']
    ]);
  });

  it('preview detects validation errors (missing name, duplicate barcode)', () => {
    const preview = previewImport(env.db, {
      businessId: env.businessId,
      entity: 'products',
      csv: PRODUCTS_CSV,
      fieldMap: { name: 0, sku: 1, barcode: 2, purchasePrice: 3, sellingPrice: 4, openingStock: 5 }
    });
    expect(preview.totalRows).toBe(4);
    const row3 = preview.errors.filter((e) => e.row === 4);
    expect(row3.some((e) => e.field === 'পণ্যের নাম')).toBe(true);
    const dupRow5 = preview.errors.filter((e) => e.row === 5);
    expect(dupRow5.some((e) => e.field === 'বারকোড')).toBe(true);
  });

  it('imports valid rows, reports failures, keeps data consistent', () => {
    const res = executeImport(env.db, {
      businessId: env.businessId,
      userId: env.adminUserId,
      entity: 'products',
      csv: PRODUCTS_CSV,
      fieldMap: { name: 0, sku: 1, barcode: 2, purchasePrice: 3, sellingPrice: 4, openingStock: 5 }
    });
    // row1 valid, row2 valid (no sku), row3 invalid (no name), row4 invalid (dup barcode)
    expect(res.imported).toBe(2);
    expect(res.failed).toBe(2);
    const products = queryProducts(env.db, { businessId: env.businessId, search: 'চিপস' });
    expect(products.rows).toHaveLength(1);
    const row = products.rows[0] as unknown as { selling_price_paise: number; current_stock: number };
    expect(row.selling_price_paise).toBe(1500);
    expect(row.current_stock).toBe(100);

    const job = listImportJobs(env.db, env.businessId)[0];
    const errs = getImportErrors(env.db, env.businessId, job.id as string);
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });

  it('customer import with opening due', () => {
    const csv = `name,phone,openingDue
সোহেল,01710000001,250
নাঈম,01710000002,`;
    const res = executeImport(env.db, {
      businessId: env.businessId,
      userId: env.adminUserId,
      entity: 'customers',
      csv,
      fieldMap: { name: 0, phone: 1, openingDue: 2 }
    });
    expect(res.imported).toBe(2);
    const customers = listCustomers(env.db, { businessId: env.businessId });
    expect(customers.rows).toHaveLength(2);
    const sohail = customers.rows.find((c) => c.name === 'সোহেল')! as { due_balance_paise: number };
    expect(sohail.due_balance_paise).toBe(25000);
  });

  it('supplier import', () => {
    const csv = `name,company,openingPayable
স্টার ট্রেডার্স,স্টার গ্রুপ,5000
সিটি স্টোর,,`;
    const res = executeImport(env.db, {
      businessId: env.businessId,
      userId: env.adminUserId,
      entity: 'suppliers',
      csv,
      fieldMap: { name: 0, company: 1, openingPayable: 2 }
    });
    expect(res.imported).toBe(2);
    const suppliers = listSuppliers(env.db, { businessId: env.businessId });
    expect(suppliers.rows).toHaveLength(2);
  });

  it('rejects import when no valid rows', () => {
    const csv = 'name,sku\n,CHP-9\n,CHP-10';
    expect(() =>
      executeImport(env.db, {
        businessId: env.businessId,
        userId: env.adminUserId,
        entity: 'products',
        csv,
        fieldMap: { name: 0, sku: 1 }
      })
    ).toThrow();
  });
});
