export interface IDBConnection {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ lastID?: number; changes?: number }>;
  transaction(ops: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
  isOpen(): boolean;
  close(): Promise<void>;
}

export interface DBConnectionOptions {
  persist?: boolean;
  filePath?: string;
}

export type DBConnectionFactory = (
  name: string,
  opts?: DBConnectionOptions,
) => Promise<IDBConnection>;
