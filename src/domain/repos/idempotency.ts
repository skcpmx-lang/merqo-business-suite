/**
 * Idempotency-key store (§ double-submission protection).
 *
 * A write request carries an idempotency key (per session). The SAME key
 * with the SAME payload replays the stored result instead of running the
 * operation twice; the same key with a DIFFERENT payload is rejected.
 *
 * This is pure domain logic (no Electron), so the exact enforcement path
 * the IPC boundary uses is directly testable.
 */
import { createHash } from 'node:crypto';
import type { DB } from '../db/connection';
import { ConflictError } from '../errors';

export interface IdemScope {
  businessId: string;
  sessionId: string;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function runIdempotent<T>(
  db: DB,
  scope: IdemScope,
  key: string | undefined,
  payload: unknown,
  fn: () => T
): T {
  if (!key) return fn();
  const payloadHash = sha256(JSON.stringify(payload ?? null));
  const existing = db
    .prepare('SELECT result, request_hash FROM idempotency_keys WHERE business_id = ? AND session_id = ? AND idem_key = ?')
    .get(scope.businessId, scope.sessionId, key) as { result: string; request_hash: string } | undefined;
  if (existing) {
    if (existing.request_hash !== payloadHash) {
      throw new ConflictError('এই রিকোয়েস্ট চাবিটি অন্য ডেটার সাথে আগে ব্যবহৃত হয়েছে। নতুন চাবির সাথে চেষ্টা করুন।');
    }
    return JSON.parse(existing.result) as T;
  }
  const result = fn();
  const serialized = JSON.stringify(result ?? null);
  try {
    db.prepare(
      `INSERT INTO idempotency_keys (id, business_id, session_id, idem_key, request_hash, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sha256(`${scope.sessionId}:${key}:${payloadHash}`), scope.businessId, scope.sessionId, key,
      payloadHash, serialized, Date.now()
    );
  } catch {
    // UNIQUE collision = concurrent duplicate; re-read and replay
    const again = db
      .prepare('SELECT result FROM idempotency_keys WHERE business_id = ? AND session_id = ? AND idem_key = ?')
      .get(scope.businessId, scope.sessionId, key) as { result: string } | undefined;
    if (again) return JSON.parse(again.result) as T;
  }
  return result;
}
