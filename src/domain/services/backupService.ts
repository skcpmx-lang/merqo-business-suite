/**
 * Backup & restore service (§59, §60).
 *
 * Backups are full-file copies of the SQLite database (WAL checkpointed
 * first so the copy is consistent), with SHA-256 verification and a registry
 * row. Restore = stop writing → overwrite DB file → reopen (the main process
 * performs the file swap; this service manages registry + verification).
 *
 * All business data lives in one SQLite file, so a file backup is a complete
 * restore unit — no partial states possible.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, statSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { recordAudit } from './auditService';
import { getSetting, setSetting } from '../repos/settings';
import { ValidationError } from '../errors';

export interface BackupRecord {
  id: string;
  file_name: string;
  file_path: string;
  size_bytes: number;
  sha256: string;
  status: string;
  created_at: number;
  created_by: string | null;
}

export function defaultBackupDirectory(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return path.join(home, 'MERQO', 'backups');
}

export function getBackupDirectory(db: DB, businessId: string): string {
  return getSetting<string>(db, businessId, 'backup', 'directory', '') || defaultBackupDirectory();
}

export function setBackupDirectory(db: DB, businessId: string, dir: string, userId?: string): void {
  setSetting(db, businessId, 'backup', 'directory', dir, userId);
}

function sha256File(file: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(file));
  return hash.digest('hex');
}

/**
 * Structural sanity check on a backup file BEFORE trusting it for a restore:
 * open it read-only and run `PRAGMA quick_check`. A matching hash only proves
 * the file is unchanged since the backup — the database itself can still be
 * corrupt, so we confirm it opens cleanly first.
 */
function quickCheckSqlite(file: string): boolean {
  let check: Database.Database;
  try {
    check = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    return false;
  }
  try {
    const res = check.pragma('quick_check') as { quick_check: string }[];
    return res.length === 1 && res[0].quick_check === 'ok';
  } catch {
    return false;
  } finally {
    try {
      check.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Create a backup. The DB must be the live application database; WAL is
 * checkpointed first so the file copy is a consistent snapshot.
 */
export function createBackup(
  db: DB,
  input: { businessId: string; userId?: string; directory?: string }
): BackupRecord {
  const dir = input.directory ?? getBackupDirectory(db, input.businessId);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw new ValidationError(`ব্যাকআপ ফোল্ডার তৈরি করা যায়নি। (${String(e)})`);
  }

  // consistent snapshot
  db.pragma('wal_checkpoint(TRUNCATE)');
  const dbFile = (db as unknown as { name: string }).name;
  if (!dbFile || dbFile === ':memory:') {
    throw new ValidationError('ইন-মেমরি ডাটাবেস ব্যাকআপ করা যায় না।');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `MERQO_backup_${stamp}.db`;
  const filePath = path.join(dir, fileName);
  copyFileSync(dbFile, filePath);

  const size = statSync(filePath).size;
  const sha = sha256File(filePath);
  const id = generateId();
  // Registry row + audit must land together (or not at all).
  tx(db, () => {
    db.prepare(
      `INSERT INTO backups (id, business_id, file_name, file_path, size_bytes, sha256, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, ?)`
    ).run(id, input.businessId, fileName, filePath, size, sha, input.userId ?? null, Date.now());
    recordAudit(db, {
      businessId: input.businessId, userId: input.userId, action: 'backup.create',
      entityType: 'backup', entityId: id, after: { file: fileName, size, sha256: sha.slice(0, 12) }
    });
  });
  return {
    id, file_name: fileName, file_path: filePath, size_bytes: size,
    sha256: sha, status: 'verified', created_at: Date.now(), created_by: input.userId ?? null
  };
}

export function listBackups(db: DB, businessId: string): BackupRecord[] {
  return db
    .prepare('SELECT * FROM backups WHERE business_id = ? ORDER BY created_at DESC')
    .all(businessId) as BackupRecord[];
}

/** Verify an existing backup file still matches its recorded hash. */
export function verifyBackup(db: DB, businessId: string, backupId: string): { ok: boolean; message: string } {
  const b = db
    .prepare('SELECT * FROM backups WHERE id = ? AND business_id = ?')
    .get(backupId, businessId) as BackupRecord | undefined;
  if (!b) throw new ValidationError('ব্যাকআপ পাওয়া যাচ্ছে না।');
  if (!existsSync(b.file_path)) {
    db.prepare("UPDATE backups SET status = 'missing' WHERE id = ?").run(b.id);
    return { ok: false, message: 'ব্যাকআপ ফাইলটি পাওয়া যাচ্ছে না।' };
  }
  const sha = sha256File(b.file_path);
  const ok = sha === b.sha256;
  db.prepare('UPDATE backups SET status = ? WHERE id = ?').run(ok ? 'verified' : 'failed', b.id);
  return { ok, message: ok ? 'ব্যাকআপ সঠিক।' : 'ব্যাকআপ ফাইলে পরিবর্তন/ক্ষতি আছে।' };
}

/**
 * Prepare a restore: copies the backup file to a temp location next to the
 * live DB. The main process then swaps the file while the app is stopped /
 * DB closed. Returns the temp path.
 */
export function prepareRestore(
  db: DB,
  input: { businessId: string; userId?: string; backupId: string }
): string {
  const b = db
    .prepare('SELECT * FROM backups WHERE id = ? AND business_id = ? AND status IN (\'verified\', \'completed\')')
    .get(input.backupId, input.businessId) as BackupRecord | undefined;
  if (!b) throw new ValidationError('সঠিক ব্যাকআপ নির্বাচন করুন।');
  if (!existsSync(b.file_path)) throw new ValidationError('ব্যাকআপ ফাইলটি পাওয়া যাচ্ছে না।');
  const sha = sha256File(b.file_path);
  if (sha !== b.sha256) {
    throw new ValidationError('ব্যাকআপ ফাইলটি যাচাই করা যায়নি — পুনরুদ্ধার সম্ভব নয়।');
  }
  // Hash matches, but the database must also open cleanly.
  if (!quickCheckSqlite(b.file_path)) {
    db.prepare("UPDATE backups SET status = 'failed' WHERE id = ?").run(b.id);
    throw new ValidationError('ব্যাকআপ ফাইলটি ক্ষতিগ্রস্ত — পুনরুদ্ধার সম্ভব নয়।');
  }
  const dbFile = (db as unknown as { name: string }).name;
  const tempPath = `${dbFile}.restore-${Date.now()}`;
  copyFileSync(b.file_path, tempPath);
  recordAudit(db, {
    businessId: input.businessId, userId: input.userId, action: 'backup.restore_prepare',
    entityType: 'backup', entityId: b.id, after: { file: b.file_name }
  });
  return tempPath;
}

export function commitRestore(db: DB, businessId: string, userId: string | undefined): void {
  recordAudit(db, {
    businessId, userId, action: 'backup.restore_complete',
    entityType: 'backup', meta: { at: Date.now() }
  });
}

export function deleteBackup(db: DB, input: { businessId: string; userId?: string; backupId: string }): void {
  const b = db
    .prepare('SELECT * FROM backups WHERE id = ? AND business_id = ?')
    .get(input.backupId, input.businessId) as BackupRecord | undefined;
  if (!b) throw new ValidationError('ব্যাকআপ পাওয়া যাচ্ছে না।');
  if (existsSync(b.file_path)) {
    try {
      rmSync(b.file_path);
    } catch {
      // keep registry row but mark deleted
    }
  }
  db.prepare("UPDATE backups SET status = 'deleted' WHERE id = ?").run(b.id);
  recordAudit(db, {
    businessId: input.businessId, userId: input.userId, action: 'backup.delete',
    entityType: 'backup', entityId: b.id, before: { file: b.file_name }
  });
}
