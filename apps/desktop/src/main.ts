import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { createDesktopConnection, runMigrations } from '@ledger/database';
import type { IDBConnection } from '@ledger/database';

let db: IDBConnection | null = null;

async function initDB(): Promise<void> {
  const filePath = path.join(app.getPath('userData'), 'ledger.db');
  db = await createDesktopConnection('ledger', { filePath });
  await runMigrations(db);
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    win.loadFile(path.join(process.resourcesPath, 'web-dist', 'index.html'));
  } else {
    win.loadFile(path.join(__dirname, '../../web/dist/index.html'));
  }
}

ipcMain.handle('db:query', async (_event, sql: string, params: unknown[]) => {
  if (!db) throw new Error('Database not initialized');
  return db.query(sql, params);
});

ipcMain.handle('db:run', async (_event, sql: string, params: unknown[]) => {
  if (!db) throw new Error('Database not initialized');
  return db.run(sql, params);
});

ipcMain.handle(
  'db:transaction',
  async (_event, ops: Array<{ sql: string; params?: unknown[] }>) => {
    if (!db) throw new Error('Database not initialized');
    return db.transaction(ops);
  },
);

ipcMain.handle('db:close', async () => {
  if (!db) return;
  await db.close();
  db = null;
});

ipcMain.handle('db:isOpen', () => {
  return db?.isOpen() ?? false;
});

app.whenReady().then(async () => {
  await initDB();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
