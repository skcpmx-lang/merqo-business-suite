/**
 * Sequential reference allocation. MUST be called inside the caller's
 * transaction so the number and the document commit atomically (§83).
 * Numbers are never reused after void/return — voids keep their number.
 */
import type { DB } from '../db/connection';

export function allocateReference(db: DB, prefix: string): number {
  db.prepare(
    `INSERT INTO sequences (name, last_value) VALUES (?, 1)
     ON CONFLICT (name) DO UPDATE SET last_value = last_value + 1`
  ).run(prefix);
  const row = db.prepare('SELECT last_value FROM sequences WHERE name = ?').get(prefix) as {
    last_value: number;
  };
  return row.last_value;
}

export function peekReference(db: DB, prefix: string): number {
  const row = db.prepare('SELECT last_value FROM sequences WHERE name = ?').get(prefix) as
    | { last_value: number }
    | undefined;
  return row?.last_value ?? 0;
}
