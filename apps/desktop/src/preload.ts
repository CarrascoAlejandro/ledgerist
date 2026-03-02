import { contextBridge, ipcRenderer } from 'electron';

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
});
