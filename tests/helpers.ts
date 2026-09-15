/**
 * Test helpers — isolated temp databases, never touching production data.
 * Every test gets a fresh on-disk DB + a fresh business workspace.
 */
import { openTempDatabase, type DB } from '../src/domain/db/connection';
import { createBusiness } from '../src/domain/services/setupService';
import { insertUnit, insertCategory, insertProduct } from '../src/domain/repos/master';
import { receive } from '../src/domain/services/inventoryService';
import { login as loginFn, type LoginResult } from '../src/domain/services/userService';
import { generateId } from '../src/shared/ids';

export interface TestEnv {
  db: DB;
  businessId: string;
  adminUserId: string;
  unitId: string;
  categoryId: string;
  login: () => LoginResult;
  close: () => void;
}

export function makeEnv(opts?: {
  openingCash?: number;
  adminPassword?: string;
}): TestEnv {
  const { db } = openTempDatabase();
  const { businessId, adminUserId } = createBusiness(db, {
    name: 'টেলে-টেস্ট শপ',
    ownerName: 'টেস্ট মালিক',
    phone: '01700000000',
    adminUsername: 'admin',
    adminPassword: opts?.adminPassword ?? 'admin1234',
    openingBalances: { cash: opts?.openingCash ?? 10000000 } // ৳1,00,000
  });
  const unitId = insertUnit(db, businessId, 'পিস (টেস্ট)', 'testpc');
  const categoryId = insertCategory(db, businessId, 'টেস্ট ক্যাটাগরি');
  const doLogin = () => loginFn(db, businessId, 'admin', opts?.adminPassword ?? 'admin1234');
  return {
    db,
    businessId,
    adminUserId,
    unitId,
    categoryId,
    login: doLogin,
    close: () => {
      db.close();
    }
  };
}

/** Create a simple product with opening stock via a movement (no purchase doc). */
export function makeProduct(
  env: TestEnv,
  opts: {
    name: string;
    sku?: string;
    barcode?: string;
    cost?: number;
    price?: number;
    stock?: number;
    minPrice?: number;
  }
): string {
  const { db, businessId, adminUserId } = env;
  const id = insertProduct(db, {
    businessId,
    name: opts.name,
    sku: opts.sku,
    unitId: env.unitId,
    purchasePricePaise: opts.cost ?? 10000,
    sellingPricePaise: opts.price ?? 15000,
    minSellingPricePaise: opts.minPrice ?? 0,
    userId: adminUserId
  });
  if (opts.barcode) {
    db.prepare(
      'INSERT INTO product_barcodes (id, business_id, product_id, barcode, is_primary, created_at) VALUES (?, ?, ?, ?, 1, ?)'
    ).run(generateId(), businessId, id, opts.barcode, Date.now());
  }
  if (opts.stock) {
    receive(db, {
      businessId,
      productId: id,
      quantity: opts.stock,
      unitCostPaise: opts.cost ?? 10000,
      movementType: 'opening_stock',
      reason: 'প্রারম্ভিক স্টক',
      userId: adminUserId
    });
  }
  return id;
}
