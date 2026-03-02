import type { IDBConnection, DBConnectionOptions } from '../connection.js';
import { WebDBConnection } from './web.js';

async function loadFromIndexedDB(dbName: string): Promise<Uint8Array | null> {
  const IDB_STORE_NAME = 'ledger-sqljs';
  const IDB_DB_NAME = 'ledger-sqljs-store';
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
