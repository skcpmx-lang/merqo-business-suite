/**
 * Versioned migration runner. Migrations are immutable, ordered, and each
 * runs inside its own transaction. Never edit an applied migration — add a
 * new one (§127).
 */
import type { DB } from './connection';
import { m0001_init } from './migrations/0001_init';
import { m0002_seed_system, seedPermissions } from './migrations/0002_seed_system';
import { m0003_session_tokens } from './migrations/0003_session_tokens';
import { m0004_return_cogs } from './migrations/0004_return_cogs';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'init_schema', sql: m0001_init },
  { version: 2, name: 'seed_system_catalog', sql: m0002_seed_system },
  { version: 3, name: 'session_tokens_idempotency', sql: m0003_session_tokens },
  { version: 4, name: 'return_cogs_credit_override', sql: m0004_return_cogs }
];

export function runMigrations(db: DB): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set<number>(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => (r as { version: number }).version)
  );

  let lastApplied = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const apply = db.transaction(() => {
      db.exec(m.sql);
      // The permission catalog is shared-code-driven; re-seed it whenever a
      // migration can add new permission keys (idempotent INSERT OR IGNORE).
      if (m.name === 'seed_system_catalog' || m.name === 'return_cogs_credit_override') {
        seedPermissions(db);
      }
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        Date.now()
      );
    });
    apply();
    lastApplied = m.version;
  }
  return lastApplied;
}

export function schemaVersion(db: DB): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}
