export interface DBOperation {
  sql: string;
  params?: unknown[];
}

export interface IDBConnection {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ lastID?: number; changes?: number }>;
  transaction(ops: DBOperation[]): Promise<void>;
  isOpen(): boolean;
  close(): Promise<void>;
  /**
   * Optional bulk-write window: drivers with expensive per-write persistence
   * (sql.js re-serializes the whole DB to IndexedDB on every write) may defer
   * persisting until endBulk(). Nestable; no-ops elsewhere.
   */
  beginBulk?(): void;
  endBulk?(): Promise<void>;
}

export interface DBConnectionOptions {
  persist?: boolean;
  filePath?: string;
}

export type DBConnectionFactory = (
  name: string,
  opts?: DBConnectionOptions,
) => Promise<IDBConnection>;
