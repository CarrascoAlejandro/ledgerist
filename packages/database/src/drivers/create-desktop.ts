import type { IDBConnection, DBConnectionOptions } from '../connection.js';
import { DesktopDBConnection } from './desktop.js';

export async function createDesktopConnection(
  name: string,
  opts: DBConnectionOptions = {},
): Promise<IDBConnection> {
  const filePath = opts.filePath ?? `${name}.db`;
  // Dynamic import so better-sqlite3 (native addon) is never loaded in web/test environments.
  const BetterSqlite3 = (await import('better-sqlite3')).default;
  const db = new BetterSqlite3(filePath);
  db.pragma('foreign_keys = ON');
  return new DesktopDBConnection(db);
}
