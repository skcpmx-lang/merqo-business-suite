/**
 * Restore orchestration (main process).
 *
 * The restore is a file swap: prepareRestore (domain) verifies the backup
 * hash and copies it next to the live DB. On app exit we:
 *   1. checkpoint + close the live DB
 *   2. move the verified file over the live DB file
 *   3. record the completion audit on the restored DB
 *   4. relaunch
 */
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

let pendingRestorePath: string | null = null;

/** Marker left after a successful swap; the next startup records the audit. */
export function restoreMarkerPath(dbFile: string): string {
  return path.join(path.dirname(dbFile), 'restore-completed');
}

export function setRestorePending(tempPath: string): void {
  pendingRestorePath = tempPath;
}

export function hasPendingRestore(): string | null {
  return pendingRestorePath;
}

export function clearPendingRestore(): void {
  pendingRestorePath = null;
}

/**
 * Perform the swap. `db` must already be closed. Returns true when a swap
 * happened (caller should relaunch the app).
 */
export function performRestore(dbFile: string): boolean {
  const tmp = pendingRestorePath;
  if (!tmp) return false;
  try {
    if (!existsSync(tmp)) {
      unlinkSafe(tmp);
      return false;
    }
    renameSync(tmp, dbFile);
    // WAL side files of the restored file (if any) belong to it now
    for (const suffix of ['-wal', '-shm']) {
      unlinkSafe(`${dbFile}${suffix}`);
    }
    pendingRestorePath = null;
    // The next startup records the restore-completion audit on the
    // (now restored) database.
    try {
      writeFileSync(restoreMarkerPath(dbFile), new Date().toISOString());
    } catch {
      // audit marker is best-effort
    }
    return true;
  } catch (e) {
    console.error('[merqo] restore failed:', e);
    pendingRestorePath = null;
    return false;
  }
}

function unlinkSafe(p: string): void {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    // ignore
  }
}
