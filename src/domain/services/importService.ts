/**
 * Import engine (§49). Flow: parse CSV → detect columns → user maps fields →
 * validate rows → preview with errors → confirm → import (all-or-nothing per
 * job: failing rows are reported, valid rows commit atomically).
 *
 * Supports: products, customers, suppliers.
 */
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { recordAudit } from './auditService';
import { createProduct } from './productService';
import { createCustomer } from './customerService';
import { createSupplier } from './supplierService';
import { listUnits } from '../repos/master';
import { toPaise, parseTaka } from '../../shared/money';
import { ValidationError } from '../errors';

export type { ImportEntity } from '../../shared/importFields';
import { FIELD_DEFINITIONS } from '../../shared/importFields';
import type { ImportEntity } from '../../shared/importFields';

export interface FieldMap {
  [target: string]: number; // target field → source column index
}

export interface RowError {
  row: number;
  field?: string;
  value?: string;
  message: string;
}

export interface ImportPreview {
  totalRows: number;
  validRows: number;
  errors: RowError[];
  sample: Record<string, string>[];
}

/** Parse CSV text (handles quoted fields, \n/\r\n). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}


export function previewImport(
  db: DB,
  input: { businessId: string; entity: ImportEntity; csv: string; fieldMap: FieldMap }
): ImportPreview {
  const rows = parseCsv(input.csv);
  if (rows.length < 2) throw new ValidationError('ফাইলে ডেটা নেই (মিনিমাম: হেডার + ১ সারি)।');
  const header = rows[0];
  const dataRows = rows.slice(1);
  const defs = FIELD_DEFINITIONS[input.entity];

  const errors: RowError[] = [];
  const unitNames = new Set(listUnits(db, input.businessId).map((u) => (u.name as string).trim()));
  const seenBarcodes = new Set<string>();
  const seenSkus = new Set<string>();

  dataRows.forEach((r, idx) => {
    const rowNum = idx + 2; // 1-based + header
    const get = (key: string) => {
      const col = input.fieldMap[key];
      if (col === undefined) return '';
      return (r[col] ?? '').trim();
    };
    for (const def of defs) {
      const value = get(def.key);
      if (def.required && value === '') {
        errors.push({ row: rowNum, field: def.label, message: 'এই ঘরটি আবশ্যক।' });
        continue;
      }
      if (value === '') continue;
      if (def.money) {
        try {
          const p = parseTaka(value);
          if (p < 0) errors.push({ row: rowNum, field: def.label, value, message: 'মূল্য ঋণাত্মক হতে পারে না।' });
        } catch {
          errors.push({ row: rowNum, field: def.label, value, message: 'সঠিক সংখ্যা নয়।' });
        }
      }
      if (def.number) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) {
          errors.push({ row: rowNum, field: def.label, value, message: 'সঠিক সংখ্যা নয়।' });
        }
      }
    }
    if (input.entity === 'products') {
      const unit = get('unit');
      if (unit && unitNames.size > 0 && !unitNames.has(unit)) {
        errors.push({ row: rowNum, field: 'একক', value: unit, message: 'এই এককটি সিস্টেমে নেই।' });
      }
      const barcode = get('barcode');
      if (barcode) {
        const inDb = db
          .prepare('SELECT 1 FROM product_barcodes WHERE business_id = ? AND barcode = ?')
          .get(input.businessId, barcode);
        const inFile = seenBarcodes.has(barcode);
        if (inDb || inFile) {
          errors.push({ row: rowNum, field: 'বারকোড', value: barcode, message: inFile ? 'এই বারকোড ফাইলে আগেই ব্যবহৃত হয়েছে।' : 'এই বারকোড ইতিমধ্যে ব্যবহৃত আছে।' });
        } else {
          seenBarcodes.add(barcode);
        }
      }
      const sku = get('sku');
      if (sku) {
        const inDb = db
          .prepare('SELECT 1 FROM products WHERE business_id = ? AND sku = ? AND status <> \'deleted\'')
          .get(input.businessId, sku);
        const inFile = seenSkus.has(sku);
        if (inDb || inFile) {
          errors.push({ row: rowNum, field: 'SKU', value: sku, message: inFile ? 'এই SKU ফাইলে আগেই ব্যবহৃত হয়েছে।' : 'এই SKU ইতিমধ্যে ব্যবহৃত আছে।' });
        } else {
          seenSkus.add(sku);
        }
      }
    }
  });

  const errorRows = new Set(errors.map((e) => e.row));
  return {
    totalRows: dataRows.length,
    validRows: dataRows.length - errorRows.size,
    errors: errors.slice(0, 500),
    sample: dataRows.slice(0, 5).map((r) => {
      const out: Record<string, string> = {};
      for (const [key, col] of Object.entries(input.fieldMap)) out[defs.find((d) => d.key === key)?.label ?? key] = r[col] ?? '';
      return out;
    })
  };
}

export function executeImport(
  db: DB,
  input: { businessId: string; userId: string; entity: ImportEntity; csv: string; fieldMap: FieldMap }
): { jobId: string; imported: number; skipped: number; failed: number; errorFile: string | null } {
  const preview = previewImport(db, input);
  if (preview.totalRows === 0) throw new ValidationError('আমদানি করার মতো কোনো ডেটা নেই।');
  if (preview.validRows === 0) {
    throw new ValidationError('কোনো সঠিক সারি নেই — ত্রুটিগুলো ঠিক করে আবার চেষ্টা করুন।');
  }

  const rows = parseCsv(input.csv).slice(1);
  const defs = FIELD_DEFINITIONS[input.entity];
  const get = (r: string[], key: string) => {
    const col = input.fieldMap[key];
    if (col === undefined) return '';
    return (r[col] ?? '').trim();
  };

  const units = listUnits(db, input.businessId);
  const unitById = new Map(units.map((u) => [(u.name as string).trim(), u.id as string]));
  // Blank unit cell → the business's system (base) unit, else the first
  // active unit. Never a fabricated "test" unit.
  const defaultUnit = units.find((u) => (u.is_system as number) === 1) ?? units[0] ?? null;
  const categoryByName = new Map<string, string>(
    (db
      .prepare('SELECT name, id FROM product_categories WHERE business_id = ? AND is_active = 1')
      .all(input.businessId) as { name: string; id: string }[])
      .map((c) => [c.name.trim(), c.id])
  );

  const errorRows = new Set(preview.errors.map((e) => e.row));
  const importErrors: RowError[] = [];
  let imported = 0;
  const jobId = generateId();

  tx(db, () => {
    rows.forEach((r, idx) => {
      const rowNum = idx + 2;
      if (errorRows.has(rowNum)) {
        importErrors.push({ row: rowNum, message: 'প্রিভিউ ভ্যালিডেশন ব্যর্থ' });
        return;
      }
      try {
        if (input.entity === 'products') {
          const unitKey = get(r, 'unit') || (defaultUnit ? (defaultUnit.name as string) : '');
          const unitId = unitKey ? (unitById.get(unitKey) ?? null) : (defaultUnit?.id as string | null);
          if (!unitId) {
            importErrors.push({ row: rowNum, field: 'একক', value: unitKey, message: 'একক পাওয়া যায়নি' });
            return;
          }
          const category = get(r, 'category');
          createProduct(db, {
            businessId: input.businessId,
            userId: input.userId,
            name: get(r, 'name'),
            sku: get(r, 'sku') || undefined,
            barcodes: get(r, 'barcode') ? [get(r, 'barcode')] : [],
            categoryId: category ? categoryByName.get(category) ?? null : null,
            unitId,
            purchasePricePaise: get(r, 'purchasePrice') ? parseTaka(get(r, 'purchasePrice')) : 0,
            sellingPricePaise: get(r, 'sellingPrice') ? parseTaka(get(r, 'sellingPrice')) : 0,
            openingStock: get(r, 'openingStock') ? Number(get(r, 'openingStock')) : 0,
            reorderLevel: get(r, 'reorderLevel') ? Number(get(r, 'reorderLevel')) : 0
          });
        } else if (input.entity === 'customers') {
          createCustomer(db, {
            businessId: input.businessId,
            userId: input.userId,
            name: get(r, 'name'),
            phone: get(r, 'phone') || undefined,
            email: get(r, 'email') || undefined,
            address: get(r, 'address') || undefined,
            creditLimitPaise: get(r, 'creditLimit') ? parseTaka(get(r, 'creditLimit')) : 0,
            openingDuePaise: get(r, 'openingDue') ? parseTaka(get(r, 'openingDue')) : 0
          });
        } else {
          createSupplier(db, {
            businessId: input.businessId,
            userId: input.userId,
            name: get(r, 'name'),
            company: get(r, 'company') || undefined,
            phone: get(r, 'phone') || undefined,
            address: get(r, 'address') || undefined,
            contactPerson: get(r, 'contactPerson') || undefined,
            openingPayablePaise: get(r, 'openingPayable') ? parseTaka(get(r, 'openingPayable')) : 0
          });
        }
        imported++;
      } catch (e) {
        importErrors.push({ row: rowNum, message: e instanceof Error ? e.message : 'অজানা ত্রুটি' });
      }
    });

    const failed = rows.length - imported;
    db.prepare(
      `INSERT INTO import_jobs
       (id, business_id, entity_type, file_name, total_rows, imported_rows, skipped_rows, failed_rows, status, report_json, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      jobId, input.businessId, input.entity, 'csv', rows.length, imported, 0, failed,
      failed > 0 ? 'completed_with_errors' : 'completed',
      JSON.stringify({ errors: importErrors.slice(0, 1000) }),
      input.userId, Date.now()
    );
    for (const err of importErrors) {
      db.prepare(
        'INSERT INTO import_errors (id, import_job_id, row_no, field, value, message) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(generateId(), jobId, err.row, err.field ?? null, err.value ?? null, err.message);
    }
    recordAudit(db, {
      businessId: input.businessId, userId: input.userId, action: 'import.run',
      entityType: 'import_job', entityId: jobId,
      after: { entity: input.entity, imported, failed }
    });
    if (failed > 0) {
      // partial failure is reported, but valid rows already committed (documented)
    }
  });

  return {
    jobId,
    imported,
    skipped: 0,
    failed: rows.length - imported,
    errorFile: null
  };
}

export function listImportJobs(db: DB, businessId: string, limit = 20) {
  return db
    .prepare(
      `SELECT j.*, u.name AS user_name, (SELECT COUNT(*) FROM import_errors e WHERE e.import_job_id = j.id) AS error_count
       FROM import_jobs j LEFT JOIN users u ON u.id = j.user_id
       WHERE j.business_id = ? ORDER BY j.created_at DESC LIMIT ?`
    )
    .all(businessId, limit) as Record<string, unknown>[];
}

export function getImportErrors(db: DB, businessId: string, jobId: string, limit = 500) {
  return db
    .prepare(
      `SELECT e.* FROM import_errors e
       JOIN import_jobs j ON j.id = e.import_job_id
       WHERE j.business_id = ? AND e.import_job_id = ? ORDER BY e.row_no LIMIT ?`
    )
    .all(businessId, jobId, limit) as Record<string, unknown>[];
}

export { toPaise };
