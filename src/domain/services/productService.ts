/**
 * Product management service (§24, §25).
 * CRUD with validation (unique SKU/barcode), price history logging,
 * opening stock, barcode/QR payloads, and the product detail aggregate.
 */
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { type Paise } from '../../shared/money';
import { recordAudit } from './auditService';
import {
  insertProduct, updateProduct, setProductBarcodes, getProduct,
  queryProducts, listCategories, insertCategory, updateCategory,
  listBrands, insertBrand, listUnits, logPriceChange, listPriceHistory,
  type ProductInput, type ProductQuery, type ProductRow
} from '../repos/master';
import { receive } from './inventoryService';
import { ValidationError, NotFoundError, ConflictError, InvalidStateError } from '../errors';

export interface CreateProductInput extends Omit<ProductInput, 'businessId' | 'userId' | 'at'> {
  businessId: string;
  userId: string;
}

export function createProduct(db: DB, input: CreateProductInput): string {
  if (!input.name?.trim()) throw new ValidationError('পণ্যের নাম দিন।');
  if (!input.unitId) throw new ValidationError('একক নির্বাচন করুন।');

  const { businessId, userId, barcodes, openingStock, openingCostPaise, ...rest } = input;

  // validate sku
  if (rest.sku) {
    const dupSku = db
      .prepare('SELECT id FROM products WHERE business_id = ? AND sku = ? AND status <> \'deleted\'')
      .get(businessId, rest.sku);
    if (dupSku) throw new ConflictError(`এই SKU (${rest.sku}) ইতিমধ্যে ব্যবহৃত হচ্ছে।`);
  }
  for (const b of barcodes ?? []) {
    const dup = db
      .prepare('SELECT barcode FROM product_barcodes WHERE business_id = ? AND barcode = ?')
      .get(businessId, b);
    if (dup) throw new ConflictError(`এই বারকোড (${b}) ইতিমধ্যে অন্য পণ্যে ব্যবহৃত হচ্ছে।`);
  }
  if (rest.sellingPricePaise !== undefined && rest.sellingPricePaise < 0) throw new ValidationError('দাম ঋণাত্মক হতে পারে না।');
  if (openingStock !== undefined && openingStock < 0) throw new ValidationError('প্রাথমিক স্টক ঋণাত্মক হতে পারে না।');

  let id = '';
  tx(db, () => {
    id = insertProduct(db, {
      ...rest,
      barcodes,
      businessId,
      userId,
      status: rest.status ?? 'active'
    });
    if (openingStock && openingStock > 0) {
      receive(db, {
        businessId,
        productId: id,
        quantity: openingStock,
        unitCostPaise: openingCostPaise ?? rest.purchasePricePaise ?? 0,
        movementType: 'opening_stock',
        reason: 'প্রাথমিক স্টক',
        userId
      });
    }
    recordAudit(db, {
      businessId, userId, action: 'product.create', entityType: 'product', entityId: id,
      after: { name: input.name, sku: rest.sku ?? '', prices: { p: rest.purchasePricePaise, s: rest.sellingPricePaise } }
    });
  });
  return id;
}

export interface UpdateProductInput {
  businessId: string;
  userId: string;
  productId: string;
  patch: Partial<Omit<ProductInput, 'businessId' | 'barcodes' | 'openingStock' | 'openingCostPaise'>>;
  newBarcodes?: string[];
  priceChangeReason?: string;
}

type PriceKey = 'purchasePricePaise' | 'sellingPricePaise' | 'wholesalePricePaise' | 'minSellingPricePaise' | 'promotionalPricePaise';
const PRICE_FIELDS: [PriceKey, string][] = [
  ['purchasePricePaise', 'purchase_price'],
  ['sellingPricePaise', 'selling_price'],
  ['wholesalePricePaise', 'wholesale_price'],
  ['minSellingPricePaise', 'min_selling_price'],
  ['promotionalPricePaise', 'promotional_price']
];

export function updateProductSafe(db: DB, input: UpdateProductInput): void {
  const product = getProduct(db, input.productId);
  if (!product) throw new NotFoundError('পণ্য', input.productId);
  if (product.business_id !== input.businessId) throw new NotFoundError('পণ্য', input.productId);

  const patch = { ...input.patch };
  if (patch.sku) {
    const dup = db
      .prepare('SELECT id FROM products WHERE business_id = ? AND sku = ? AND id <> ?')
      .get(input.businessId, patch.sku, input.productId);
    if (dup) throw new ConflictError(`এই SKU (${patch.sku}) ইতিমধ্যে ব্যবহৃত হচ্ছে।`);
  }
  if (input.newBarcodes) {
    for (const b of input.newBarcodes) {
      const dup = db
        .prepare('SELECT barcode FROM product_barcodes WHERE business_id = ? AND barcode = ? AND product_id <> ?')
        .get(input.businessId, b, input.productId);
      if (dup) throw new ConflictError(`এই বারকোড (${b}) ইতিমধ্যে অন্য পণ্যে ব্যবহৃত হচ্ছে।`);
    }
  }

  tx(db, () => {
    // Log price changes before applying (§25)
    for (const [prop, field] of PRICE_FIELDS) {
      const next = patch[prop];
      if (next !== undefined) {
        const oldVal = (product as unknown as Record<string, number | null>)[field] ?? 0;
        const newVal = next as number | null;
        if (oldVal !== newVal) {
          logPriceChange(
            db, input.businessId, input.productId, field,
            oldVal, newVal ?? null, input.userId, input.priceChangeReason ?? ''
          );
        }
      }
    }
    updateProduct(db, input.businessId, input.productId, patch, input.userId);
    if (input.newBarcodes) {
      setProductBarcodes(db, input.businessId, input.productId, input.newBarcodes);
    }
    recordAudit(db, {
      businessId: input.businessId, userId: input.userId, action: 'product.update',
      entityType: 'product', entityId: input.productId, after: Object.keys(patch).length
    });
  });
}

export function softDeleteProduct(db: DB, input: { businessId: string; userId: string; productId: string }): void {
  const product = getProduct(db, input.productId);
  if (!product) throw new NotFoundError('পণ্য', input.productId);
  const stock = db
    .prepare('SELECT COALESCE(quantity, 0) AS q FROM inventory WHERE product_id = ? AND business_id = ?')
    .get(input.productId, input.businessId) as { q: number };
  if (stock.q > 0.00001) {
    throw new ConflictError('স্টক থাকা পণ্য মুছে ফেলা যায় না — আগে স্টক সমন্বয় করুন।');
  }
  updateProduct(db, input.businessId, input.productId, { status: 'deleted' }, input.userId);
  recordAudit(db, {
    businessId: input.businessId, userId: input.userId, action: 'product.delete',
    entityType: 'product', entityId: input.productId, before: { name: product.name }
  });
}

export function getProductDetail(db: DB, businessId: string, productId: string) {
  const product = getProduct(db, productId);
  if (!product || product.business_id !== businessId) return undefined;
  const barcodes = db
    .prepare('SELECT * FROM product_barcodes WHERE product_id = ? ORDER BY is_primary DESC')
    .all(productId) as Record<string, unknown>[];
  const salesAgg = db
    .prepare(
      `SELECT COALESCE(SUM(quantity), 0) AS qty, COALESCE(SUM(line_total_paise), 0) AS revenue,
              COALESCE(SUM(cogs_paise), 0) AS cogs
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.product_id = ? AND s.status <> 'voided' AND s.business_id = ?`
    )
    .get(productId, businessId) as { qty: number; revenue: number; cogs: number };
  const purchasesAgg = db
    .prepare(
      `SELECT COALESCE(SUM(quantity), 0) AS qty, COALESCE(SUM(line_total_paise), 0) AS cost
       FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
       WHERE pi.product_id = ? AND p.business_id = ?`
    )
    .get(productId, businessId) as { qty: number; cost: number };
  const movements = db
    .prepare(
      `SELECT m.*, u.name AS user_name FROM inventory_movements m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.product_id = ? ORDER BY m.created_at DESC LIMIT 100`
    )
    .all(productId) as Record<string, unknown>[];
  const batches = db
    .prepare("SELECT * FROM product_batches WHERE product_id = ? AND status = 'active' ORDER BY expiry_date IS NULL, expiry_date ASC")
    .all(productId) as Record<string, unknown>[];
  const priceHistory = listPriceHistory(db, businessId, productId, 20);
  const stock = db
    .prepare('SELECT quantity, avg_cost_paise FROM inventory WHERE product_id = ? AND business_id = ?')
    .get(productId, businessId) as { quantity: number; avg_cost_paise: number } | undefined;

  return {
    product,
    barcodes,
    stock: { quantity: stock?.quantity ?? 0, avgCostPaise: stock?.avg_cost_paise ?? 0, valuePaise: Math.round((stock?.quantity ?? 0) * (stock?.avg_cost_paise ?? 0)) },
    sales: salesAgg,
    purchases: purchasesAgg,
    movements,
    batches,
    priceHistory,
    marginPaise: product.selling_price_paise - (stock?.avg_cost_paise ?? product.purchase_price_paise)
  };
}

export {
  queryProducts, getProduct, listCategories, insertCategory, updateCategory,
  listBrands, insertBrand, listUnits, listPriceHistory, ProductQuery
};
