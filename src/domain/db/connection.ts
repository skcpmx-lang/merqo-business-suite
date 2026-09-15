/**
 * Database connection + migration runner.
 *
 * - SQLite (better-sqlite3), WAL mode, foreign keys ON.
 * - Versioned migrations applied in order, tracked in schema_migrations.
 * - Every application service gets the same Database instance; long-running
 *   work uses explicit transactions (see `tx` helper).
 */
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations, MIGRATIONS } from './migrate';

export type DB = Database.Database;

export interface DatabaseOptions {
  /** File path, or ':memory:' for tests. */
  file: string;
}

export function openDatabase(file: string): DB {
  if (file !== ':memory:') {
    const dir = path.dirname(file);
    try {
      const { mkdirSync } = require('node:fs');
      mkdirSync(dir, { recursive: true });
    } catch {
      // best effort; open will fail with a clear error otherwise
    }
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}

/**
 * Run `fn` inside a transaction. If `fn` throws, everything is rolled back.
 * Nested calls join the outer transaction (savepoint semantics via SQLite
 * transactions are handled by better-sqlite3's Transaction wrapper).
 */
export function tx<T>(db: DB, fn: () => T): T {
  const run = db.transaction(fn);
  return run();
}

export interface IntegrityCheck {
  ok: boolean;
  issues: string[];
}

/** Startup integrity self-check (§60): detect recoverable issues. */
export function checkIntegrity(db: DB): IntegrityCheck {
  const issues: string[] = [];
  try {
    const res = db.pragma('integrity_check', { simple: false }) as unknown[];
    if (Array.isArray(res) && res.length > 0 && res[0] !== 'ok') {
      issues.push('integrity_check: ' + JSON.stringify(res));
    }
    const fk = db.pragma('foreign_key_check', { simple: false }) as unknown[];
    if (Array.isArray(fk) && fk.length > 0) {
      issues.push('foreign_key_check: ' + JSON.stringify(fk.slice(0, 5)));
    }
  } catch (e) {
    issues.push('integrity_check failed: ' + String(e));
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Open a temporary on-disk database (used by tests to exercise WAL/journal
 * paths; ':memory:' cannot be copied for backup tests).
 */
export function openTempDatabase(): { db: DB; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'merqo-test-'));
  const db = openDatabase(path.join(dir, 'test.db'));
  return { db, dir };
}

export { MIGRATIONS };
