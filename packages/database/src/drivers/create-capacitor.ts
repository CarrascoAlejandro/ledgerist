import type { IDBConnection, DBConnectionOptions } from '../connection.js';
import { CapacitorDBConnection } from './capacitor.js';

export async function createCapacitorConnection(
  name: string,
  _opts: DBConnectionOptions = {},
): Promise<IDBConnection> {
  // Dynamic import so @capacitor-community/sqlite is never loaded in web/desktop/test environments.
  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
  const sqlite = new SQLiteConnection(CapacitorSQLite);

  // Handle webview reloads where the native side still holds a connection.
  const consistency = (await sqlite.checkConnectionsConsistency()).result ?? false;
  const exists = (await sqlite.isConnection(name, false)).result ?? false;
  const db =
    consistency && exists
      ? await sqlite.retrieveConnection(name, false)
      : await sqlite.createConnection(name, false, 'no-encryption', 1, false);

  await db.open();
  // Parity with other drivers; the Android plugin also enables FKs natively at open.
  await db.execute('PRAGMA foreign_keys = ON;', false);
  return new CapacitorDBConnection(db, name, sqlite);
}
