/**
 * Audit log (§57). Critical actions are recorded by services inside the same
 * transaction as the change they describe. Technical/system logs are separate
 * (main process file log, §95).
 */
import type { DB } from '../db/connection';
import { generateId } from '../../shared/ids';

export interface AuditInput {
  businessId: string;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  at?: number;
}

export function recordAudit(db: DB, input: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_logs
     (id, business_id, user_id, action, entity_type, entity_id, before_json, after_json, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    generateId(),
    input.businessId,
    input.userId ?? null,
    input.action,
    input.entityType ?? null,
    input.entityId ?? null,
    input.before === undefined ? null : JSON.stringify(input.before),
    input.after === undefined ? null : JSON.stringify(input.after),
    input.meta === undefined ? null : JSON.stringify(input.meta),
    input.at ?? Date.now()
  );
}

export interface AuditQuery {
  businessId: string;
  limit?: number;
  offset?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: number;
  to?: number;
}

export function queryAudit(db: DB, q: AuditQuery) {
  const where = ['business_id = ?'];
  const params: unknown[] = [q.businessId];
  if (q.action) {
    where.push('action = ?');
    params.push(q.action);
  }
  if (q.entityType) {
    where.push('entity_type = ?');
    params.push(q.entityType);
  }
  if (q.entityId) {
    where.push('entity_id = ?');
    params.push(q.entityId);
  }
  if (q.from !== undefined) {
    where.push('created_at >= ?');
    params.push(q.from);
  }
  if (q.to !== undefined) {
    where.push('created_at <= ?');
    params.push(q.to);
  }
  const limit = Math.min(q.limit ?? 100, 500);
  const offset = q.offset ?? 0;
  const rows = db
    .prepare(
      `SELECT a.*, u.name AS user_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as unknown[];
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE ${where.join(' AND ')}`)
    .get(...params) as { c: number };
  return { rows: rows as Record<string, unknown>[], total: total.c };
}
