import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
  db: {
    query: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:query', sql, params ?? []),
    run: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:run', sql, params ?? []),
    transaction: (ops: Array<{ sql: string; params?: unknown[] }>) =>
      ipcRenderer.invoke('db:transaction', ops),
    close: () => ipcRenderer.invoke('db:close'),
    isOpen: () => ipcRenderer.invoke('db:isOpen'),
  },
  sync: {
    serverStart: () => ipcRenderer.invoke('sync:server-start'),
    serverStop: () => ipcRenderer.invoke('sync:server-stop'),
    serverInfo: () => ipcRenderer.invoke('sync:server-info'),
    send: (connId: string, frame: Uint8Array) =>
      ipcRenderer.invoke('sync:send', connId, frame),
    closeConn: (connId: string, reason?: string) =>
      ipcRenderer.invoke('sync:close-conn', connId, reason),
    onConnOpened: (cb: (p: { connId: string; remoteAddress: string }) => void) =>
      subscribe('sync:conn-opened', cb),
    onFrame: (cb: (p: { connId: string; frame: Uint8Array }) => void) =>
      subscribe('sync:frame', cb),
    onConnClosed: (cb: (p: { connId: string; reason?: string }) => void) =>
      subscribe('sync:conn-closed', cb),
    onServerInfoChanged: (
      cb: (p: { running: boolean; port: number | null; addresses: string[] }) => void,
    ) => subscribe('sync:server-info-changed', cb),
  },
});
