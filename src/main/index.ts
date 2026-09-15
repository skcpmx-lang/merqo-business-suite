// MERQO main process entry (skeleton — fully wired in later phases).
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'MERQO',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.MERQO_DEV_URL) {
    void win.loadURL(process.env.MERQO_DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
