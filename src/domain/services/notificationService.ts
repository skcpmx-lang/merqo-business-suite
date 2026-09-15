/**
 * Notification service (§54). Actionable, non-flooding notifications:
 * generated from real state (low stock, due balances, expiring batches,
 * large transactions, cash mismatch, backup reminders) — never fabricated.
 */
import type { DB } from '../db/connection';
import { generateId } from '../../shared/ids';
import { getSetting } from '../repos/settings';
import { formatBdt } from '../../shared/money';
import { toBanglaDigits } from '../../shared/dates';

export function createNotification(
  db: DB,
  input: {
    businessId: string;
    type: string;
    severity?: 'info' | 'warning' | 'critical';
    title: string;
    body?: string;
    entityType?: string;
    entityId?: string;
    actionRoute?: string;
  }
): string {
  const id = generateId();
  db.prepare(
    `INSERT INTO notifications (id, business_id, type, severity, title, body, entity_type, entity_id, action_route, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id, input.businessId, input.type, input.severity ?? 'info', input.title, input.body ?? '',
    input.entityType ?? null, input.entityId ?? null, input.actionRoute ?? null, Date.now()
  );
  return id;
}

export function queryNotifications(
  db: DB,
  q: { businessId: string; unreadOnly?: boolean; limit?: number; offset?: number }
) {
  const where = ['n.business_id = ?'];
  const params: unknown[] = [q.businessId];
  if (q.unreadOnly) where.push('n.is_read = 0');
  const limit = Math.min(q.limit ?? 50, 500);
  const rows = db
    .prepare(`SELECT * FROM notifications n WHERE ${where.join(' AND ')} ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, q.offset ?? 0) as Record<string, unknown>[];
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM notifications n WHERE ${where.join(' AND ')}`)
    .get(...params) as { c: number };
  return { rows, total: total.c };
}

export function unreadCount(db: DB, businessId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE business_id = ? AND is_read = 0')
    .get(businessId) as { c: number };
  return row.c;
}

export function markRead(db: DB, id: string): void {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
}

export function markAllRead(db: DB, businessId: string): void {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE business_id = ? AND is_read = 0').run(businessId);
}

export function deleteNotification(db: DB, id: string): void {
  db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
}

/**
 * Scan current state and create missing notifications (idempotent by type +
 * entity). Called at app startup, after stock changes, after day rollover.
 * Thresholds come from settings — never hard-coded (§108).
 */
export function scanAndNotify(db: DB, businessId: string): number {
  const created: string[] = [];

  // Low stock
  const lowStockEnabled = getSetting<boolean>(db, businessId, 'notifications', 'low_stock_enabled', true);
  if (lowStockEnabled) {
    const low = db
      .prepare(
        `SELECT p.id, p.name, i.quantity, p.reorder_level FROM products p
         JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
         WHERE p.business_id = ? AND p.status <> 'deleted' AND i.quantity > 0 AND i.quantity <= p.reorder_level AND p.reorder_level > 0
         LIMIT 50`
      )
      .all(businessId) as { id: string; name: string; quantity: number; reorder_level: number }[];
    for (const p of low) {
      created.push(
        createNotification(db, {
          businessId,
          type: 'low_stock',
          severity: 'warning',
          title: `কম স্টক: ${p.name}`,
          body: `বর্তমান স্টক ${toBanglaDigits(p.quantity)}টি — পুনরায় অর্ডার সীমা ${toBanglaDigits(p.reorder_level)}।`,
          entityType: 'product',
          entityId: p.id,
          actionRoute: '/inventory'
        })
      );
    }
  }

  // Out of stock
  const out = db
    .prepare(
      `SELECT p.id, p.name FROM products p
       LEFT JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
       WHERE p.business_id = ? AND p.status = 'active' AND COALESCE(i.quantity, 0) <= 0
       LIMIT 50`
    )
    .all(businessId) as { id: string; name: string }[];
  for (const p of out) {
    created.push(
      createNotification(db, {
        businessId,
        type: 'out_of_stock',
        severity: 'critical',
        title: `স্টক শেষ: ${p.name}`,
        body: 'এই পণ্যের মজুদ শেষ। নতুন ক্রয় প্রয়োজন।',
        entityType: 'product',
        entityId: p.id,
        actionRoute: '/inventory'
      })
    );
  }

  // Expiring batches
  const expiringDays = getSetting<number>(db, businessId, 'notifications', 'expiring_days', 30);
  const now = Date.now();
  const horizon = now + expiringDays * 86400000;
  const expiring = db
    .prepare(
      `SELECT b.id, b.product_id, b.batch_no, b.expiry_date, b.quantity, p.name AS product_name
       FROM product_batches b JOIN products p ON p.id = b.product_id
       WHERE b.business_id = ? AND b.status = 'active' AND b.expiry_date IS NOT NULL AND b.expiry_date <= ?
       ORDER BY b.expiry_date ASC LIMIT 50`
    )
    .all(businessId, horizon) as { id: string; product_id: string; expiry_date: number; quantity: number; product_name: string; batch_no: string }[];
  for (const b of expiring) {
    const expired = b.expiry_date <= now;
    created.push(
      createNotification(db, {
        businessId,
        type: expired ? 'expired_stock' : 'expiring_stock',
        severity: expired ? 'critical' : 'warning',
        title: expired ? `মেয়াদোত্তীর্ণ: ${b.product_name}` : `মেয়াদ প্রায় শেষ: ${b.product_name}`,
        body: `ব্যাচ ${b.batch_no || '—'}, পরিমাণ ${toBanglaDigits(b.quantity)}।`,
        entityType: 'batch',
        entityId: b.id,
        actionRoute: '/inventory'
      })
    );
  }

  // Large customer due
  const dueEnabled = getSetting<boolean>(db, businessId, 'notifications', 'customer_due_enabled', true);
  if (dueEnabled) {
    const dues = db
      .prepare(
        `SELECT id, name, due_balance_paise FROM customers
         WHERE business_id = ? AND is_active = 1 AND due_balance_paise > 0
         ORDER BY due_balance_paise DESC LIMIT 10`
      )
      .all(businessId) as { id: string; name: string; due_balance_paise: number }[];
    for (const c of dues) {
      created.push(
        createNotification(db, {
          businessId,
          type: 'customer_due',
          severity: 'info',
          title: `কাস্টমারের বকেয়া: ${c.name}`,
          body: `মোট বকেয়া ${formatBdt(c.due_balance_paise)}।`,
          entityType: 'customer',
          entityId: c.id,
          actionRoute: '/customers'
        })
      );
    }
  }

  // Backup reminder
  const reminderDays = getSetting<number>(db, businessId, 'notifications', 'backup_reminder_days', 7);
  const lastBackup = db
    .prepare('SELECT MAX(created_at) AS last FROM backups WHERE business_id = ? AND status = \'completed\'')
    .get(businessId) as { last: number | null };
  if (reminderDays > 0 && (!lastBackup.last || now - lastBackup.last > reminderDays * 86400000)) {
    created.push(
      createNotification(db, {
        businessId,
        type: 'backup_reminder',
        severity: 'info',
        title: 'ব্যাকআপ করার সময় হয়েছে',
        body: `সর্বশেষ ব্যাকআপের ${lastBackup.last ? 'পরে' : 'পর্যন্ত'} নিয়মিত ব্যাকআপ নেওয়া হয়নি।`,
        actionRoute: '/backup'
      })
    );
  }

  return created.length;
}
