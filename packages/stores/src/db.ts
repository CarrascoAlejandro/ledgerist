import type { IDBConnection } from '@ledger/database';

let _db: IDBConnection | null = null;

export function setDB(db: IDBConnection): void {
  _db = db;
}

export function getDB(): IDBConnection {
  if (!_db) throw new Error('DB not initialized. Call setDB() before using stores.');
  return _db;
}
