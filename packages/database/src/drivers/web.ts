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
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return rows;
  }

  async run(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ lastID?: number; changes?: number }> {
    if (Array.isArray(params) && params.some((p) => p === null || p === undefined)) {
      // eslint-disable-next-line no-console
      console.warn('[db] run with nullish params', {
        sql,
        params,
      });
    }
    this.execute(sql, params);
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
    this.execute('BEGIN');
    try {
      for (const op of ops) {
        this.execute(op.sql, op.params ?? []);
      }
      this.execute('COMMIT');
    } catch (err) {
      this.execute('ROLLBACK');
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

  private execute(sql: string, params: unknown[] = []): void {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    while (stmt.step()) {
      // Intentionally drain results for statements that return rows.
    }
    stmt.free();
  }
}

export async function createWebConnection(
  name: string,
  opts: DBConnectionOptions = {},
): Promise<IDBConnection> {
  const { persist = true } = opts;

  // Dynamically import sql.js to avoid bundler issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sqlJsModule = (await import('sql.js')) as any;
  let initSqlJsFrom =
    (typeof sqlJsModule?.default?.default === 'function' && 'default.default') ||
    (typeof sqlJsModule?.default === 'function' && 'default') ||
    (typeof sqlJsModule?.initSqlJs === 'function' && 'initSqlJs') ||
    (typeof sqlJsModule === 'function' && 'module') ||
    'unknown';
  let initSqlJs =
    sqlJsModule?.default?.default ??
    sqlJsModule?.default ??
    sqlJsModule?.initSqlJs ??
    sqlJsModule;
  if (typeof initSqlJs !== 'function') {
    // eslint-disable-next-line no-console
    console.info('[db] sql.js init export: unknown', {
      keys: Object.keys(sqlJsModule ?? {}),
      defaultType: typeof sqlJsModule?.default,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqlJsWasmModule = (await import('sql.js/dist/sql-wasm.js')) as any;
    initSqlJsFrom =
      (typeof sqlJsWasmModule?.default?.default === 'function' &&
        'dist/sql-wasm.default.default') ||
      (typeof sqlJsWasmModule?.default === 'function' && 'dist/sql-wasm.default') ||
      (typeof sqlJsWasmModule?.initSqlJs === 'function' && 'dist/sql-wasm.initSqlJs') ||
      (typeof sqlJsWasmModule === 'function' && 'dist/sql-wasm.module') ||
      'unknown';
    initSqlJs =
      sqlJsWasmModule?.default?.default ??
      sqlJsWasmModule?.default ??
      sqlJsWasmModule?.initSqlJs ??
      sqlJsWasmModule;
  }
  // eslint-disable-next-line no-console
  console.info('[db] sql.js init export:', initSqlJsFrom);
  if (typeof initSqlJs !== 'function') {
    throw new Error('sql.js initSqlJs export not found');
  }
  const wasmUrl = new URL('sql.js/dist/sql-wasm.wasm', import.meta.url).toString();
  // eslint-disable-next-line no-console
  console.info('[db] sql.js wasm url:', wasmUrl);
  const SQL = await initSqlJs({
    locateFile: (f: string) => (f.endsWith('.wasm') ? wasmUrl : `/assets/${f}`),
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
