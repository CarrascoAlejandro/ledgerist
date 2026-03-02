import type { IDBConnection } from '../connection.js';
import type Database from 'better-sqlite3';

export class DesktopDBConnection implements IDBConnection {
  private db: Database.Database;
  private open: boolean;

  constructor(db: Database.Database) {
    this.db = db;
    this.open = true;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async run(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ lastID?: number; changes?: number }> {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return {
      lastID: Number(result.lastInsertRowid),
      changes: result.changes,
    };
  }

  async transaction(ops: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    const fn = this.db.transaction(() => {
      for (const op of ops) {
        this.db.prepare(op.sql).run(...(op.params ?? []));
      }
    });
    fn();
  }

  isOpen(): boolean {
    return this.open;
  }

  async close(): Promise<void> {
    if (this.open) {
      this.db.close();
      this.open = false;
    }
  }
}
