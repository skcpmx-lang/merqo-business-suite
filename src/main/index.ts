/**
 * MERQO main process.
 *
 *  - single-instance lock
 *  - app database in %APPDATA%/merqo (WAL, migrations on open)
 *  - startup integrity self-check (§60)
 *  - IPC: typed handler registry (handlers.ts) + app/print channels here
 *  - optional auto-backup on startup (settings: backup.auto_enabled)
 *  - graceful shutdown: pending restore → file swap + relaunch
 */
import path from 'node:path';
import fs from 'node:fs';
import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import { openDatabase, checkIntegrity, type DB } from '../domain/db/connection';
import { getActiveBusiness } from '../domain/services/setupService';
import { createBackup } from '../domain/services/backupService';
import { getSetting, setSetting } from '../domain/repos/settings';
import { version } from '../../package.json';
import { schemaVersion } from '../domain/db/migrate';
import { registerIpc, toIpcError } from './ipc/handlers';
import { resolveSession, requirePermission } from '../domain/services/userService';
import { receiptHtml, invoiceHtml } from './print/receipts';
import { hasPendingRestore, performRestore, clearPendingRestore, restoreMarkerPath } from './restore';
import { commitRestore } from '../domain/services/backupService';
import { IPC, MAIN_EVENTS } from '../shared/ipc';
import { ValidationError, UnauthorizedError } from '../domain/errors';

let db: DB;
let mainWindow: BrowserWindow | null = null;

function showSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  return mainWindow ? dialog.showSaveDialog(mainWindow, options) : dialog.showSaveDialog(options);
}

function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options);
}

function dataDir(): string {
  return path.join(app.getPath('userData'), 'merqo');
}

function dbFile(): string {
  return path.join(dataDir(), 'merqo.db');
}

/* ---------------- single instance ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(onReady).catch((e) => {
    dialog.showErrorBox('MERQO', `সফটওয়্যারটি চালু করা যায়নি:\n${String(e)}`);
    app.quit();
  });
}

function onReady(): void {
  // error log
  const logDir = dataDir();
  fs.mkdirSync(logDir, { recursive: true });
  const errLog = path.join(logDir, 'main-error.log');
  process.on('uncaughtException', (e) => {
    // Full detail goes to the log only; the user sees a generic, safe
    // message (raw stack traces are never shown to normal users).
    try {
      fs.appendFileSync(errLog, `[${new Date().toISOString()}] uncaught: ${e?.stack ?? e}\n`);
    } catch {
      // ignore
    }
    dialog.showErrorBox(
      'MERQO',
      'অপ্রত্যাশিত ত্রুটি ঘটেছে। আপনার ডেটা নিরাপদ。\n\nসমস্যাটি সমাধান করতে অ্যাপটি বন্ধ করে আবার চালু করুন।'
    );
  });
  process.on('unhandledRejection', (e) => {
    try {
      fs.appendFileSync(errLog, `[${new Date().toISOString()}] rejection: ${String(e)}\n`);
    } catch {
      // ignore
    }
  });

  // A restore temp file left behind by a crashed restore is useless —
  // clean it up before the database is opened.
  cleanupOrphanRestoreTemps();

  db = openDatabase(dbFile());

  // startup integrity self-check
  const integrity = checkIntegrity(db);
  if (!integrity.ok) {
    console.error('[merqo] integrity issues:', integrity.issues);
  }

  // If the previous run swapped in a backup, record the completion audit
  // on the (now restored) database.
  maybeCommitRestoreAudit();

  // onRestore: after prepareRestore the app restarts; the before-quit hook
  // performs the file swap and relaunches, so here we only need to quit.
  registerIpc(db, { onRestore: () => app.quit() });
  registerAppIpc();
  buildMenu();
  maybeAutoBackup();
  createWindow();
}

/** Remove `merqo.db.restore-*` temp files from a crashed restore. */
function cleanupOrphanRestoreTemps(): void {
  try {
    for (const f of fs.readdirSync(dataDir())) {
      if (f.startsWith('merqo.db.restore-')) {
        fs.rmSync(path.join(dataDir(), f), { force: true });
      }
    }
  } catch {
    // data dir may not exist yet
  }
}

/** Record the restore-completion audit once, then clear the marker. */
function maybeCommitRestoreAudit(): void {
  const marker = restoreMarkerPath(dbFile());
  try {
    if (!fs.existsSync(marker)) return;
    const biz = getActiveBusiness(db);
    if (biz) commitRestore(db, biz.id as string, undefined);
    fs.rmSync(marker, { force: true });
  } catch (e) {
    console.error('[merqo] restore audit commit failed:', e);
  }
}

/* ---------------- window ---------------- */

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 740,
    title: 'MERQO',
    backgroundColor: '#f6f8f7',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Sandboxed renderer: no Node, no filesystem — the preload bridge is
      // the only door to the main process.
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (process.env.MERQO_DEV_URL) {
    void mainWindow.loadURL(process.env.MERQO_DEV_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  // open external links in the default browser, never in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ---------------- menu ---------------- */

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'ফাইল',
      submenu: [
        {
          label: 'ডেটা ব্যাকআপ…',
          accelerator: 'CmdOrCtrl+Alt+B',
          click: () => mainWindow?.webContents.send(MAIN_EVENTS.MENU_BACKUP)
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'বিদায়' }
      ]
    },
    { role: 'editMenu', label: 'সম্পাদনা' },
    { role: 'viewMenu', label: 'ভিউ' },
    {
      label: 'সহায়তা',
      submenu: [
        {
          label: 'MERQO সম্পর্কে',
          click: () => {
            const opts: Electron.MessageBoxOptions = {
              type: 'info',
              title: 'MERQO',
              message: 'MERQO',
              detail: `সংস্করণ ${version}\nবাংলা বিক্রয় ব্যবস্থাপনা সফটওয়্যার\n\nসম্পূর্ণ অফলাইনে কাজ করে। আপনার সব ডেটা এই কম্পিউটারে থাকে।`,
              buttons: ['ঠিক আছে']
            };
            if (mainWindow) void dialog.showMessageBox(mainWindow, opts);
            else void dialog.showMessageBox(opts);
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- app-level IPC (no session) ---------------- */

function registerAppIpc(): void {
  ipcMain.handle(IPC.APP_INFO, () => {
    try {
      return {
        ok: true,
        data: {
          version,
          platform: process.platform,
          schemaVersion: schemaVersion(db),
          dataDirectory: dataDir()
        }
      };
    } catch (e) {
      return { ok: false, error: toIpcError(e) };
    }
  });

  ipcMain.handle(IPC.APP_INTEGRITY, () => {
    try {
      return { ok: true, data: checkIntegrity(db) };
    } catch (e) {
      return { ok: false, error: toIpcError(e) };
    }
  });

  ipcMain.handle(IPC.APP_SAVE_FILE, async (_e, defaultName: string, content: string) => {
    if (typeof defaultName !== 'string' || typeof content !== 'string') {
      throw new ValidationError('সঠিক ফাইল তথ্য দিন।');
    }
    // Never let a client-supplied name escape the downloads folder.
    const safeName = path.basename(defaultName) || 'merqo-export.csv';
    const { canceled, filePath } = await showSaveDialog({
      title: 'ফাইল সংরক্ষণ করুন',
      defaultPath: path.join(app.getPath('downloads'), safeName),
      filters: [
        { name: 'CSV ফাইল', extensions: ['csv'] },
        { name: 'PDF ফাইল', extensions: ['pdf'] },
        { name: 'সব ফাইল', extensions: ['*'] }
      ]
    });
    if (canceled || !filePath) return { ok: true, data: null };
    try {
      const isBinary = filePath.toLowerCase().endsWith('.pdf');
      fs.writeFileSync(filePath, isBinary ? content as unknown as Buffer : content);
      return { ok: true, data: filePath };
    } catch (e) {
      return { ok: false, error: toIpcError(e) };
    }
  });

  ipcMain.handle(IPC.APP_PICK_DIRECTORY, async (_e, title?: string) => {
    const { canceled, filePaths } = await showOpenDialog({
      title: typeof title === 'string' ? title : 'ফোল্ডার বাছাই করুন',
      properties: ['openDirectory', 'createDirectory']
    });
    if (canceled || filePaths.length === 0) return { ok: true, data: null };
    return { ok: true, data: filePaths[0] };
  });

  /* ---- print ---- */
  // Print renders documents from domain data in the main process. The
  // renderer-supplied token is resolved to a session, the user must hold
  // invoices.view, and the sale is looked up within that user's business —
  // a token can never pull a document from another business.
  const printAuth = (token: string): string => {
    const user = resolveSession(db, token);
    if (!user) throw new UnauthorizedError('সেশনটি শেষ হয়ে গেছে। আবার লগইন করুন।');
    requirePermission(user, 'invoices.view');
    return user.businessId;
  };

  ipcMain.handle(IPC.PRINT_RECEIPT_HTML, (_e, token: string, saleId: string, paper?: '57mm' | '80mm' | 'A4') => {
    try {
      const businessId = printAuth(token);
      return { ok: true, data: receiptHtml(db, businessId, saleId, paper ?? '80mm') };
    } catch (e) {
      return { ok: false, error: toIpcError(e) };
    }
  });
  ipcMain.handle(IPC.PRINT_INVOICE_HTML, (_e, token: string, saleId: string) => {
    try {
      const businessId = printAuth(token);
      return { ok: true, data: invoiceHtml(db, businessId, saleId) };
    } catch (e) {
      return { ok: false, error: toIpcError(e) };
    }
  });
  ipcMain.handle(IPC.PRINT_PDF, async (_e, token: string, req: { html: string; defaultFileName: string; paper?: '57mm' | '80mm' | 'A4' }) => {
    try {
      printAuth(token);
      if (!req || typeof req.html !== 'string' || typeof req.defaultFileName !== 'string') {
        throw new ValidationError('সঠিক প্রিন্ট তথ্য দিন।');
      }
      const pdf = await renderToPdf(req.html, req.paper ?? 'A4');
      const safeName = path.basename(req.defaultFileName) || 'merqo.pdf';
      const { canceled, filePath } = await showSaveDialog({
        title: 'PDF সংরক্ষণ করুন',
        defaultPath: path.join(app.getPath('downloads'), safeName),
        filters: [{ name: 'PDF ফাইল', extensions: ['pdf'] }]
      });
      if (canceled || !filePath) return { ok: true, data: null };
      try {
        fs.writeFileSync(filePath, pdf);
        return { ok: true, data: filePath };
      } catch (e) {
        return { ok: false, error: toIpcError(e) };
      }
    } catch (e) {
      return { ok: false, error: toIpcError(e) };
    }
  });
  ipcMain.handle(IPC.PRINT_TO_PRINTER, async (_e, token: string, req: { html: string; printerName?: string }) => {
    try {
      printAuth(token);
      if (!req || typeof req.html !== 'string') {
        throw new ValidationError('সঠিক প্রিন্ট তথ্য দিন।');
      }
      const printed = await printToPrinter(req.html, req.printerName);
      return { ok: true, data: { printed } };
    } catch (e) {
      return { ok: false, error: toIpcError(e) };
    }
  });
}

function offscreenWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width: 400,
    height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
}

/** Render an HTML string to PDF via an offscreen webContents. */
async function renderToPdf(html: string, paper: '57mm' | '80mm' | 'A4'): Promise<Buffer> {
  const holder = offscreenWindow();
  try {
    await holder.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // printToPDF pageSize {width, height} is in INCHES.
    // 57mm ≈ 2.24in, 80mm ≈ 3.15in. A tall page keeps a receipt on one page.
    const options: Electron.PrintToPDFOptions =
      paper === 'A4'
        ? { pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } }
        : {
            printBackground: true,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            pageSize: paper === '57mm' ? { width: 2.24, height: 20 } : { width: 3.15, height: 20 }
          };
    return await holder.webContents.printToPDF(options);
  } finally {
    holder.destroy();
  }
}

/** Send HTML to a physical printer via an offscreen webContents. */
async function printToPrinter(html: string, printerName?: string): Promise<boolean> {
  const holder = offscreenWindow();
  try {
    await holder.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await new Promise<boolean>((resolve) => {
      holder.webContents.print(
        { printBackground: true, ...(printerName ? { deviceName: printerName } : {}) },
        (success, failureReason) => {
          if (!success && failureReason) {
            console.error('[merqo] print failed:', failureReason);
          }
          resolve(success);
        }
      );
    });
  } finally {
    holder.destroy();
  }
}

/* ---------------- auto backup on startup ---------------- */

function maybeAutoBackup(): void {
  try {
    const biz = getActiveBusiness(db);
    if (!biz) return;
    const bizId = biz.id as string;
    const enabled = getSetting<boolean>(db, bizId, 'backup', 'auto_enabled', false);
    if (!enabled) return;
    const intervalDays = getSetting<number>(db, bizId, 'backup', 'auto_interval_days', 7);
    const lastAt = getSetting<number>(db, bizId, 'backup', 'last_auto_at', 0);
    const now = Date.now();
    if (now - (lastAt ?? 0) < intervalDays * 86_400_000) return;
    const owner = db
      .prepare('SELECT id FROM users WHERE business_id = ? AND is_owner = 1 LIMIT 1')
      .get(bizId) as { id: string } | undefined;
    createBackup(db, { businessId: bizId, userId: owner?.id });
    setSetting(db, bizId, 'backup', 'last_auto_at', now, owner?.id);
  } catch (e) {
    console.error('[merqo] auto backup failed:', e);
  }
}

/* ---------------- shutdown / restore ---------------- */

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (e) => {
  const pending = hasPendingRestore();
  if (!pending) {
    safeCloseDb();
    return;
  }
  e.preventDefault();
  const file = dbFile();
  safeCloseDb();
  if (performRestore(file)) {
    app.relaunch();
    app.quit();
  } else {
    clearPendingRestore();
    app.quit();
  }
});

function safeCloseDb(): void {
  try {
    if (db) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    }
  } catch (e) {
    console.error('[merqo] db close failed:', e);
  }
}
