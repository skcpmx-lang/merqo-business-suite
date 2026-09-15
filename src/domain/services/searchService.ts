/**
 * Global search (§11) — one fast query across the main business entities,
 * categorized results. Each facet is capped so the UI never floods.
 */
import type { DB } from '../db/connection';

export interface SearchResults {
  products: { id: string; name: string; sku: string; barcode: string | null; stock: number }[];
  customers: { id: string; name: string; phone: string; due: number }[];
  suppliers: { id: string; name: string; phone: string; payable: number }[];
  sales: { id: string; reference_no: string; date: number; total: number; customer: string | null }[];
  purchases: { id: string; reference_no: string; date: number; total: number; supplier: string | null }[];
}

export function globalSearch(db: DB, businessId: string, term: string, limit = 8): SearchResults {
  const t = term.trim();
  const like = `%${t}%`;
  const empty = (arr: never[] = []) => arr;

  if (t.length < 1) return { products: empty(), customers: empty(), suppliers: empty(), sales: empty(), purchases: empty() };

  const products = db
    .prepare(
      `SELECT p.id, p.name, p.sku,
              (SELECT barcode FROM product_barcodes pb WHERE pb.product_id = p.id ORDER BY is_primary DESC LIMIT 1) AS barcode,
              COALESCE((SELECT quantity FROM inventory i WHERE i.product_id = p.id AND i.business_id = ?), 0) AS stock
       FROM products p
       WHERE p.business_id = ? AND p.status <> 'deleted'
         AND (p.name LIKE ? OR p.sku LIKE ? OR p.id IN (SELECT product_id FROM product_barcodes WHERE business_id = ? AND barcode LIKE ?))
       LIMIT ?`
    )
    .all(businessId, businessId, like, like, businessId, like, limit) as SearchResults['products'];

  const customers = db
    .prepare(
      `SELECT id, name, phone, due_balance_paise AS due FROM customers
       WHERE business_id = ? AND is_active = 1 AND (name LIKE ? OR phone LIKE ?)
       LIMIT ?`
    )
    .all(businessId, like, like, limit) as SearchResults['customers'];

  const suppliers = db
    .prepare(
      `SELECT id, name, phone, payable_balance_paise AS payable FROM suppliers
       WHERE business_id = ? AND is_active = 1 AND (name LIKE ? OR phone LIKE ?)
       LIMIT ?`
    )
    .all(businessId, like, like, limit) as SearchResults['suppliers'];

  const sales = db
    .prepare(
      `SELECT s.id, s.reference_no, s.date, s.total_paise AS total, c.name AS customer
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.business_id = ? AND (s.reference_no LIKE ? OR c.name LIKE ?)
       ORDER BY s.date DESC LIMIT ?`
    )
    .all(businessId, like, like, limit) as SearchResults['sales'];

  const purchases = db
    .prepare(
      `SELECT p.id, p.reference_no, p.date, p.total_paise AS total, s.name AS supplier
       FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.business_id = ? AND (p.reference_no LIKE ? OR s.name LIKE ? OR p.supplier_invoice_no LIKE ?)
       ORDER BY p.date DESC LIMIT ?`
    )
    .all(businessId, like, like, like, limit) as SearchResults['purchases'];

  return { products, customers, suppliers, sales, purchases };
}
