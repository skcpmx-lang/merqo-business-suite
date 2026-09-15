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
import { receiptHtml, invoiceHtml } from './print/receipts';
import { hasPendingRestore, performRestore, clearPendingRestore } from './restore';
import { IPC } from '../shared/ipc';
import { ValidationError, NotFoundError } from '../domain/errors';

let db: DB;
let mainWindow: BrowserWindow | null = null;

/** dialog parent (non-optional per Electron typings) */
function parent(): Electron.BaseWindow {
  return mainWindow as unknown as Electron.BaseWindow;
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
    try {
      fs.appendFileSync(errLog, `[${new Date().toISOString()}] ${e?.stack ?? e}\n`);
    } catch {
      // ignore
    }
    dialog.showErrorBox('MERQO', `অপ্রত্যাশিত ত্রুটি ঘটেছে:\n${e?.message ?? e}`);
  });
  process.on('unhandledRejection', (e) => {
    try {
      fs.appendFileSync(errLog, `[${new Date().toISOString()}] rejection: ${String(e)}\n`);
    } catch {
      // ignore
    }
  });

  db = openDatabase(dbFile());

  // startup integrity self-check
  const integrity = checkIntegrity(db);
  if (!integrity.ok) {
    console.error('[merqo] integrity issues:', integrity.issues);
  }

  registerIpc(db);
  registerAppIpc();
  buildMenu();
  maybeAutoBackup();
  createWindow();
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
      sandbox: false,
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
          click: () => mainWindow?.webContents.send('menu:backup')
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
            dialog.showMessageBox(parent(), {
              type: 'info',
              title: 'MERQO',
              message: 'MERQO',
              detail: `সংস্করণ ${version}\nবাংলা বিক্রয় ব্যবস্থাপনা সফটওয়্যার\n\nসম্পূর্ণ অফলাইনে কাজ করে। আপনার সব ডেটা এই কম্পিউটারে থাকে।`,
              buttons: ['ঠিক আছে']
            });
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
    const { canceled, filePath } = await dialog.showSaveDialog(parent(), {
      title: 'ফাইল সংরক্ষণ করুন',
      defaultPath: path.join(app.getPath('downloads'), defaultName),
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
    const { canceled, filePaths } = await dialog.showOpenDialog(parent(), {
      title: typeof title === 'string' ? title : 'ফোল্ডার বাছাই করুন',
      properties: ['openDirectory', 'createDirectory']
    });
    if (canceled || filePaths.length === 0) return { ok: true, data: null };
    return { ok: true, data: filePaths[0] };
  });

  /* ---- print ---- */
  ipcMain.handle(IPC.PRINT_RECEIPT_HTML, (_e, token: string, saleId: string, paper: '57mm' | '80mm' | 'A4') => {
    try {
      return { ok: true, data: receiptHtml(db, saleId, paper ?? '80mm') };
    } catch (e) {
      if (e instanceof NotFoundError) return { ok: false, error: toIpcError(e) };
      return { ok: false, error: toIpcError(e) };
    }
  });
  ipcMain.handle(IPC.PRINT_INVOICE_HTML, (_e, _token: string, saleId: string) => {
    try {
      return { ok: true, data: invoiceHtml(db, saleId) };
    } catch (e) {
      return { ok: false, error: toIpcError(e) };
    }
  });
  ipcMain.handle(IPC.PRINT_PDF, async (_e, req: { html: string; defaultFileName: string; paper?: '57mm' | '80mm' | 'A4' }) => {
    try {
      if (!req || typeof req.html !== 'string' || typeof req.defaultFileName !== 'string') {
        throw new ValidationError('সঠিক প্রিন্ট তথ্য দিন।');
      }
      const pdf = await renderToPdf(req.html, req.paper ?? 'A4');
      const { canceled, filePath } = await dialog.showSaveDialog(parent(), {
        title: 'PDF সংরক্ষণ করুন',
        defaultPath: path.join(app.getPath('downloads'), req.defaultFileName),
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
}

/** Render an HTML string to PDF via an offscreen webContents. */
async function renderToPdf(html: string, paper: '57mm' | '80mm' | 'A4'): Promise<Buffer> {
  const holder = new BrowserWindow({
    show: false,
    width: 400,
    height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  try {
    await holder.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const options: Electron.PrintToPDFOptions =
      paper === 'A4'
        ? { pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } }
        : {
            printBackground: true,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            // 80mm ≈ 302px @96dpi; 57mm ≈ 215px. Tall page keeps a receipt on one page.
            pageSize: paper === '57mm' ? { width: 215, height: 1500 } : { width: 302, height: 1500 }
          };
    return await holder.webContents.printToPDF(options);
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
