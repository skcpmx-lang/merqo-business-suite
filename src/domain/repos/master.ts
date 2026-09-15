/**
 * Product master repository: products, categories, brands, units, barcodes,
 * batches, price history. Row mappers centralize snake_case → domain shape.
 */
import type { DB } from '../db/connection';
import { generateId } from '../../shared/ids';

export interface ProductRow {
  id: string;
  business_id: string;
  name: string;
  sku: string;
  category_id: string | null;
  brand_id: string | null;
  unit_id: string;
  purchase_price_paise: number;
  selling_price_paise: number;
  wholesale_price_paise: number;
  min_selling_price_paise: number;
  promotional_price_paise: number | null;
  batch_enabled: number;
  expiry_enabled: number;
  reorder_level: number;
  image_data_url: string | null;
  default_supplier_id: string | null;
  notes: string;
  status: string;
  created_at: number;
  updated_at: number;
  created_by: string | null;
  updated_by: string | null;
  category_name?: string | null;
  brand_name?: string | null;
  unit_name?: string | null;
  primary_barcode?: string | null;
  current_stock?: number;
  avg_cost_paise?: number;
}

const PRODUCT_SELECT = `
  SELECT p.*,
    c.name AS category_name,
    b.name AS brand_name,
    u.name AS unit_name,
    (SELECT pb.barcode FROM product_barcodes pb
       WHERE pb.product_id = p.id ORDER BY pb.is_primary DESC, pb.created_at ASC LIMIT 1) AS primary_barcode,
    (SELECT i.quantity FROM inventory i WHERE i.product_id = p.id AND i.business_id = p.business_id) AS current_stock,
    (SELECT i.avg_cost_paise FROM inventory i WHERE i.product_id = p.id AND i.business_id = p.business_id) AS avg_cost_paise
  FROM products p
  LEFT JOIN product_categories c ON c.id = p.category_id
  LEFT JOIN product_brands b ON b.id = p.brand_id
  LEFT JOIN product_units u ON u.id = p.unit_id
`;

export interface ProductQuery {
  businessId: string;
  search?: string;
  categoryId?: string;
  brandId?: string;
  status?: string;
  lowStockOnly?: boolean;
  outOfStockOnly?: boolean;
  limit?: number;
  offset?: number;
}

export function queryProducts(db: DB, q: ProductQuery) {
  const where = ['p.business_id = ?'];
  const params: unknown[] = [q.businessId];
  if (q.status) {
    where.push('p.status = ?');
    params.push(q.status);
  } else {
    where.push("p.status <> 'deleted'");
  }
  if (q.categoryId) {
    where.push('p.category_id = ?');
    params.push(q.categoryId);
  }
  if (q.brandId) {
    where.push('p.brand_id = ?');
    params.push(q.brandId);
  }
  if (q.search) {
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR pb0.barcode LIKE ?)');
    const like = `%${q.search}%`;
    params.push(like, like, like);
  }
  if (q.lowStockOnly) {
    where.push('COALESCE(i0.quantity, 0) > 0 AND COALESCE(i0.quantity, 0) <= p.reorder_level');
  }
  if (q.outOfStockOnly) {
    where.push('COALESCE(i0.quantity, 0) <= 0');
  }
  const limit = Math.min(q.limit ?? 50, 500);
  const offset = q.offset ?? 0;
  const rows = db
    .prepare(
      `${PRODUCT_SELECT}
       LEFT JOIN inventory i0 ON i0.product_id = p.id AND i0.business_id = p.business_id
       LEFT JOIN product_barcodes pb0 ON pb0.product_id = p.id AND pb0.is_primary = 1
       WHERE ${where.join(' AND ')}
       ORDER BY p.name COLLATE NOCASE ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as ProductRow[];
  const countWhere = ['p.business_id = ?'];
  const countParams: unknown[] = [q.businessId];
  if (q.status) countWhere.push('p.status = ?'), countParams.push(q.status);
  else countWhere.push("p.status <> 'deleted'");
  if (q.categoryId) countWhere.push('p.category_id = ?'), countParams.push(q.categoryId);
  if (q.brandId) countWhere.push('p.brand_id = ?'), countParams.push(q.brandId);
  if (q.search) countParams.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM products p
       LEFT JOIN inventory i0 ON i0.product_id = p.id AND i0.business_id = p.business_id
       LEFT JOIN product_barcodes pb0 ON pb0.product_id = p.id AND pb0.is_primary = 1
       WHERE ${countWhere.join(' AND ')} AND
         ${q.search ? '(p.name LIKE ? OR p.sku LIKE ? OR pb0.barcode LIKE ?)' : '1=1'} AND
         ${q.lowStockOnly ? 'COALESCE(i0.quantity, 0) > 0 AND COALESCE(i0.quantity, 0) <= p.reorder_level' : '1=1'} AND
         ${q.outOfStockOnly ? 'COALESCE(i0.quantity, 0) <= 0' : '1=1'}`
    )
    .get(...countParams) as { c: number };
  return { rows, total: totalRow.c };
}

export function getProduct(db: DB, id: string): ProductRow | undefined {
  return db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id) as ProductRow | undefined;
}

export function findProductByBarcode(db: DB, businessId: string, barcode: string): ProductRow | undefined {
  return db
    .prepare(
      `SELECT p.*, pb.barcode AS primary_barcode
       FROM product_barcodes pb
       JOIN products p ON p.id = pb.product_id
       WHERE pb.business_id = ? AND pb.barcode = ? AND p.status <> 'deleted'
       LIMIT 1`
    )
    .get(businessId, barcode) as ProductRow | undefined;
}

export interface ProductInput {
  businessId: string;
  name: string;
  sku?: string;
  categoryId?: string | null;
  brandId?: string | null;
  unitId: string;
  purchasePricePaise?: number;
  sellingPricePaise?: number;
  wholesalePricePaise?: number;
  minSellingPricePaise?: number;
  promotionalPricePaise?: number | null;
  batchEnabled?: boolean;
  expiryEnabled?: boolean;
  reorderLevel?: number;
  image?: string | null;
  defaultSupplierId?: string | null;
  barcodes?: string[];
  notes?: string;
  openingStock?: number;
  openingCostPaise?: number;
  status?: string;
  userId?: string | null;
  at?: number;
}

export function insertProduct(db: DB, input: ProductInput): string {
  const id = generateId();
  const now = input.at ?? Date.now();
  const primaryBarcode = input.barcodes?.[0];
  db.prepare(
    `INSERT INTO products
     (id, business_id, name, sku, category_id, brand_id, unit_id,
      purchase_price_paise, selling_price_paise, wholesale_price_paise, min_selling_price_paise,
      promotional_price_paise, batch_enabled, expiry_enabled, reorder_level,
      image_data_url, default_supplier_id, notes, status, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.businessId,
    input.name,
    input.sku ?? '',
    input.categoryId ?? null,
    input.brandId ?? null,
    input.unitId,
    input.purchasePricePaise ?? 0,
    input.sellingPricePaise ?? 0,
    input.wholesalePricePaise ?? 0,
    input.minSellingPricePaise ?? 0,
    input.promotionalPricePaise ?? null,
    input.batchEnabled ? 1 : 0,
    input.expiryEnabled ? 1 : 0,
    input.reorderLevel ?? 0,
    input.image ?? null,
    input.defaultSupplierId ?? null,
    input.notes ?? '',
    input.status ?? 'active',
    now,
    now,
    input.userId ?? null,
    input.userId ?? null
  );
  if (primaryBarcode) {
    db.prepare(
      'INSERT INTO product_barcodes (id, business_id, product_id, barcode, is_primary, created_at) VALUES (?, ?, ?, ?, 1, ?)'
    ).run(generateId(), input.businessId, id, primaryBarcode, now);
  }
  return id;
}

export function updateProduct(
  db: DB,
  id: string,
  patch: Partial<Omit<ProductInput, 'businessId' | 'barcodes' | 'openingStock' | 'openingCostPaise'>>,
  userId?: string | null
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  const map: [string, string][] = [
    ['name', 'name'], ['sku', 'sku'], ['categoryId', 'category_id'], ['brandId', 'brand_id'],
    ['unitId', 'unit_id'], ['purchasePricePaise', 'purchase_price_paise'],
    ['sellingPricePaise', 'selling_price_paise'], ['wholesalePricePaise', 'wholesale_price_paise'],
    ['minSellingPricePaise', 'min_selling_price_paise'],
    ['promotionalPricePaise', 'promotional_price_paise'],
    ['reorderLevel', 'reorder_level'], ['image', 'image_data_url'],
    ['defaultSupplierId', 'default_supplier_id'], ['notes', 'notes'], ['status', 'status']
  ];
  for (const [prop, col] of map) {
    if (prop in patch) {
      sets.push(`${col} = ?`);
      params.push((patch as Record<string, unknown>)[prop]);
    }
  }
  if ('batchEnabled' in patch) sets.push('batch_enabled = ?'), params.push(patch.batchEnabled ? 1 : 0);
  if ('expiryEnabled' in patch) sets.push('expiry_enabled = ?'), params.push(patch.expiryEnabled ? 1 : 0);
  if (sets.length === 0) return;
  sets.push('updated_at = ?', `updated_by = ?`);
  params.push(Date.now(), userId ?? null, id);
  db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function setProductBarcodes(db: DB, businessId: string, productId: string, barcodes: string[]): void {
  const existing = db
    .prepare('SELECT barcode FROM product_barcodes WHERE product_id = ?')
    .all(productId) as { barcode: string }[];
  const keep = new Set(barcodes);
  const toRemove = existing.filter((e) => !keep.has(e.barcode)).map((e) => e.barcode);
  if (toRemove.length > 0) {
    db.prepare('DELETE FROM product_barcodes WHERE product_id = ? AND barcode IN (' + toRemove.map(() => '?').join(',') + ')')
      .run(productId, ...toRemove);
  }
  const insert = db.prepare(
    `INSERT OR IGNORE INTO product_barcodes (id, business_id, product_id, barcode, is_primary, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  );
  barcodes.forEach((b, i) => {
    insert.run(generateId(), businessId, productId, b, i === 0 ? 1 : 0, Date.now());
  });
  db.prepare('UPDATE product_barcodes SET is_primary = 1 WHERE product_id = ? AND barcode = ?').run(
    productId, barcodes[0] ?? ''
  );
}

// ---------- Categories ----------
export function listCategories(db: DB, businessId: string, activeOnly = true) {
  return db
    .prepare(
      `SELECT * FROM product_categories WHERE business_id = ? AND ${activeOnly ? 'is_active = 1' : '1=1'} ORDER BY sort ASC, name COLLATE NOCASE ASC`
    )
    .all(businessId) as Record<string, unknown>[];
}

export function insertCategory(db: DB, businessId: string, name: string, sort = 0, isSystem = false): string {
  const id = generateId();
  db.prepare(
    'INSERT INTO product_categories (id, business_id, name, sort, is_active, is_system, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).run(id, businessId, name, sort, isSystem ? 1 : 0, Date.now());
  return id;
}

export function updateCategory(db: DB, id: string, patch: { name?: string; parentId?: string | null; isActive?: boolean }): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) sets.push('name = ?'), params.push(patch.name);
  if (patch.parentId !== undefined) sets.push('parent_id = ?'), params.push(patch.parentId);
  if (patch.isActive !== undefined) sets.push('is_active = ?'), params.push(patch.isActive ? 1 : 0);
  if (!sets.length) return;
  db.prepare(`UPDATE product_categories SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
}

export function deleteCategory(db: DB, id: string): void {
  db.prepare('UPDATE product_categories SET is_active = 0, parent_id = NULL WHERE id = ?').run(id);
  db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id);
}

// ---------- Brands ----------
export function listBrands(db: DB, businessId: string, activeOnly = true) {
  return db
    .prepare(`SELECT * FROM product_brands WHERE business_id = ? AND ${activeOnly ? 'is_active = 1' : '1=1'} ORDER BY name COLLATE NOCASE ASC`)
    .all(businessId) as Record<string, unknown>[];
}

export function insertBrand(db: DB, businessId: string, name: string): string {
  const id = generateId();
  db.prepare('INSERT INTO product_brands (id, business_id, name, is_active, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(id, businessId, name, Date.now());
  return id;
}

// ---------- Units ----------
export function listUnits(db: DB, businessId: string) {
  return db
    .prepare('SELECT * FROM product_units WHERE business_id = ? AND is_active = 1 ORDER BY name COLLATE NOCASE ASC')
    .all(businessId) as Record<string, unknown>[];
}

export function insertUnit(db: DB, businessId: string, name: string, code: string, isSystem = false): string {
  const id = generateId();
  db.prepare(
    'INSERT INTO product_units (id, business_id, name, code, is_system, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
  ).run(id, businessId, name, code, isSystem ? 1 : 0, Date.now());
  return id;
}

// ---------- Batches ----------
export interface BatchRecord {
  id: string;
  business_id: string;
  product_id: string;
  batch_no: string;
  expiry_date: number | null;
  quantity: number;
  unit_cost_paise: number;
  supplier_id: string | null;
  status: string;
  created_at: number;
}

export function listActiveBatches(db: DB, productId: string): BatchRecord[] {
  return db
    .prepare('SELECT * FROM product_batches WHERE product_id = ? AND status = \'active\' ORDER BY created_at ASC')
    .all(productId) as BatchRecord[];
}

export function insertBatch(
  db: DB,
  input: {
    businessId: string; productId: string; batchNo?: string; expiryDate?: number | null;
    quantity: number; unitCostPaise: number; supplierId?: string | null;
  }
): string {
  const id = generateId();
  db.prepare(
    `INSERT INTO product_batches (id, business_id, product_id, batch_no, expiry_date, quantity, unit_cost_paise, supplier_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
  ).run(id, input.businessId, input.productId, input.batchNo ?? '', input.expiryDate ?? null, input.quantity, input.unitCostPaise, input.supplierId ?? null, Date.now());
  return id;
}

export function adjustBatchQuantity(db: DB, batchId: string, delta: number): void {
  db.prepare('UPDATE product_batches SET quantity = quantity + ? WHERE id = ?').run(delta, batchId);
  db.prepare("UPDATE product_batches SET status = 'depleted' WHERE id = ? AND quantity <= 0.00001").run(batchId);
}

// ---------- Price history ----------
export function logPriceChange(
  db: DB,
  businessId: string,
  productId: string,
  field: string,
  oldValue: number | null,
  newValue: number | null,
  userId: string | null | undefined,
  reason = ''
): void {
  db.prepare(
    `INSERT INTO product_price_history (id, business_id, product_id, field, old_value, new_value, reason, changed_by, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(generateId(), businessId, productId, field, oldValue, newValue, reason, userId ?? null, Date.now());
}

export function listPriceHistory(db: DB, productId: string, limit = 50) {
  return db
    .prepare(
      `SELECT h.*, u.name AS user_name FROM product_price_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.product_id = ? ORDER BY h.changed_at DESC LIMIT ?`
    )
    .all(productId, limit) as Record<string, unknown>[];
}
