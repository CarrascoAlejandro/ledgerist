import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { createDesktopConnection, runMigrations } from '@ledger/database';
import type { IDBConnection } from '@ledger/database';
import { SyncRelayServer, getLanAddresses } from './syncServer.js';

let db: IDBConnection | null = null;
const syncServer = new SyncRelayServer();

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

// ── Sync relay (dumb frame forwarder — protocol/keys live in the renderer) ──

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

syncServer.onEvent((ev) => {
  if (ev.type === 'conn-opened') {
    broadcast('sync:conn-opened', { connId: ev.connId, remoteAddress: ev.remoteAddress });
  } else if (ev.type === 'frame') {
    broadcast('sync:frame', { connId: ev.connId, frame: ev.frame });
  } else {
    broadcast('sync:conn-closed', { connId: ev.connId, reason: ev.reason });
  }
});

function serverInfoWithAddresses() {
  return { ...syncServer.info(), addresses: getLanAddresses() };
}

ipcMain.handle('sync:server-start', async () => {
  const info = await syncServer.start();
  broadcast('sync:server-info-changed', info);
  return info;
});

ipcMain.handle('sync:server-stop', async () => {
  await syncServer.stop();
  const info = serverInfoWithAddresses();
  broadcast('sync:server-info-changed', info);
  return info;
});

ipcMain.handle('sync:server-info', () => serverInfoWithAddresses());

ipcMain.handle('sync:send', (_event, connId: string, frame: Uint8Array) => {
  return syncServer.send(connId, frame);
});

ipcMain.handle('sync:close-conn', (_event, connId: string, reason?: string) => {
  syncServer.closeConn(connId, reason);
});

app.whenReady().then(async () => {
  await initDB();

  // Auto-listen while the app is open (never block window creation on it).
  try {
    await syncServer.start();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sync] could not start sync server:', err);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Session keys live in the renderer: a reload orphans main-side conns.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('destroyed', () => syncServer.closeAllConns());
    contents.on('did-navigate', () => syncServer.closeAllConns());
  });
});

app.on('window-all-closed', async () => {
  await syncServer.stop().catch(() => undefined);
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
