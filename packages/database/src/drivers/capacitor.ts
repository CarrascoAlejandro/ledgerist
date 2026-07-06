import type { IDBConnection } from '../connection.js';

// Structural subset of @capacitor-community/sqlite's SQLiteDBConnection.
// Declared locally so this module has no static dependency on the plugin
// (keeps it out of web/desktop/test bundles and makes the class DI-testable).
export interface CapacitorSQLiteDB {
  query(statement: string, values?: unknown[]): Promise<{ values?: unknown[] }>;
  run(
    statement: string,
    values?: unknown[],
    transaction?: boolean,
  ): Promise<{ changes?: { changes?: number; lastId?: number } }>;
  executeSet(
    set: Array<{ statement: string; values: unknown[] }>,
    transaction?: boolean,
  ): Promise<unknown>;
  execute(statements: string, transaction?: boolean): Promise<unknown>;
  close(): Promise<unknown>;
}

// Structural subset of SQLiteConnection (the plugin's connection manager).
export interface CapacitorSQLiteManager {
  closeConnection(database: string, readonly: boolean): Promise<unknown>;
}

export class CapacitorDBConnection implements IDBConnection {
  private db: CapacitorSQLiteDB;
  private dbName: string;
  private sqlite: CapacitorSQLiteManager;
  private open: boolean;

  constructor(db: CapacitorSQLiteDB, dbName: string, sqlite: CapacitorSQLiteManager) {
    this.db = db;
    this.dbName = dbName;
    this.sqlite = sqlite;
    this.open = true;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.db.query(sql, params);
    return (res.values ?? []) as T[];
  }

  async run(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ lastID?: number; changes?: number }> {
    // transaction: false → autocommit; avoids a BEGIN/COMMIT round trip per call.
    const res = await this.db.run(sql, params, false);
    return {
      lastID: res.changes?.lastId,
      changes: res.changes?.changes,
    };
  }

  async transaction(ops: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    // executeSet with transaction: true does a native BEGIN/COMMIT with
    // rollback on failure, in a single bridge round trip.
    await this.db.executeSet(
      ops.map((op) => ({ statement: op.sql, values: op.params ?? [] })),
      true,
    );
  }

  isOpen(): boolean {
    return this.open;
  }

  async close(): Promise<void> {
    if (!this.open) return;
    await this.db.close();
    await this.sqlite.closeConnection(this.dbName, false);
    this.open = false;
  }
}
