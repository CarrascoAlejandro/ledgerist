import type { IDBConnection, DBConnectionOptions } from '../connection.js';

const IDB_STORE_NAME = 'ledger-sqljs';
const IDB_DB_NAME = 'ledger-sqljs-store';

async function loadFromIndexedDB(dbName: string): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DB_NAME, 1);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const getRequest = store.get(dbName);

      getRequest.onsuccess = () => {
        db.close();
        resolve(getRequest.result ? new Uint8Array(getRequest.result as ArrayBuffer) : null);
      };
      getRequest.onerror = () => {
        db.close();
        reject(getRequest.error);
      };
    };

    request.onerror = () => reject(request.error);
  });
}

async function saveToIndexedDB(dbName: string, data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DB_NAME, 1);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      const putRequest = store.put(data.buffer, dbName);

      putRequest.onsuccess = () => {
        db.close();
        resolve();
      };
      putRequest.onerror = () => {
        db.close();
        reject(putRequest.error);
      };
    };

    request.onerror = () => reject(request.error);
  });
}

export class WebDBConnection implements IDBConnection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;
  private dbName: string;
  private persist: boolean;
  private open: boolean;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(db: any, dbName: string, persist: boolean) {
    this.db = db;
    this.dbName = dbName;
    this.persist = persist;
    this.open = true;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const results = this.db.exec(sql, params);
    if (!results || results.length === 0) return [];

    const { columns, values } = results[0];
    return values.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });
      return obj as T;
    });
  }

  async run(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ lastID?: number; changes?: number }> {
    this.db.run(sql, params);
    const lastIDResult = this.db.exec('SELECT last_insert_rowid() as id');
    const changesResult = this.db.exec('SELECT changes() as n');

    const lastID =
      lastIDResult?.[0]?.values?.[0]?.[0] as number | undefined;
    const changes =
      changesResult?.[0]?.values?.[0]?.[0] as number | undefined;

    if (this.persist) {
      await this.persistToDB();
    }

    return { lastID, changes };
  }

  async transaction(ops: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    this.db.run('BEGIN');
    try {
      for (const op of ops) {
        this.db.run(op.sql, op.params ?? []);
      }
      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }

    if (this.persist) {
      await this.persistToDB();
    }
  }

  isOpen(): boolean {
    return this.open;
  }

  async close(): Promise<void> {
    if (this.open) {
      if (this.persist) {
        await this.persistToDB();
      }
      this.db.close();
      this.open = false;
    }
  }

  private async persistToDB(): Promise<void> {
    const data = this.db.export() as Uint8Array;
    await saveToIndexedDB(this.dbName, data);
  }
}

export async function createWebConnection(
  name: string,
  opts: DBConnectionOptions = {},
): Promise<IDBConnection> {
  const { persist = true } = opts;

  // Dynamically import sql.js to avoid bundler issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initSqlJs = (await import('sql.js')).default as any;
  const SQL = await initSqlJs({
    locateFile: (f: string) => `/assets/${f}`,
  });

  let db;
  if (persist) {
    const existing = await loadFromIndexedDB(name);
    if (existing) {
      db = new SQL.Database(existing);
    } else {
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  return new WebDBConnection(db, name, persist);
}
