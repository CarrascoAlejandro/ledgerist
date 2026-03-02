import type { IDBConnection } from '../connection.js';

declare global {
  interface Window {
    electronAPI: {
      db: {
        query(sql: string, params?: unknown[]): Promise<unknown[]>;
        run(sql: string, params?: unknown[]): Promise<{ lastID?: number; changes?: number }>;
        transaction(ops: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
        close(): Promise<void>;
        isOpen(): Promise<boolean>;
      };
    };
  }
}

export class ElectronRendererConnection implements IDBConnection {
  private open: boolean;

  constructor() {
    this.open = true;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = await window.electronAPI.db.query(sql, params);
    return rows as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ lastID?: number; changes?: number }> {
    return window.electronAPI.db.run(sql, params);
  }

  async transaction(ops: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    return window.electronAPI.db.transaction(ops);
  }

  isOpen(): boolean {
    return this.open;
  }

  async close(): Promise<void> {
    await window.electronAPI.db.close();
    this.open = false;
  }
}
