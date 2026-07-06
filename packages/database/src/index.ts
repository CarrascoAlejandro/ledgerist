export type { IDBConnection, DBConnectionOptions, DBConnectionFactory, DBOperation } from './connection.js';
export { runMigrations, MIGRATIONS } from './migrations.js';
export type { Migration } from './migrations.js';
export { WebDBConnection } from './drivers/web.js';
export { ElectronRendererConnection } from './drivers/electron-renderer.js';
export { createQueries, buildOps } from './queries.js';
export type { Queries, EntryData, EntryUpdateFields } from './queries.js';
export { syncStamp, STAMP_SET, STAMP_COLS, STAMP_VALS } from './syncStamp.js';
export { initSyncContext } from './syncContextInit.js';

// Lazy-load createWebConnection so that import.meta.url in create-web.ts
// is never parsed at module load time (required for Jest compatibility).
import type { IDBConnection, DBConnectionOptions } from './connection.js';
export async function createWebConnection(
  name: string,
  opts: DBConnectionOptions = {},
): Promise<IDBConnection> {
  const { createWebConnection: factory } = await import('./drivers/create-web.js');
  return factory(name, opts);
}

// Lazy-load createDesktopConnection so that better-sqlite3 (native addon) is never
// loaded in web or test environments.
export async function createDesktopConnection(
  name: string,
  opts: DBConnectionOptions = {},
): Promise<IDBConnection> {
  const { createDesktopConnection: factory } = await import('./drivers/create-desktop.js');
  return factory(name, opts);
}

// Lazy-load createCapacitorConnection so that @capacitor-community/sqlite is never
// loaded in web, desktop, or test environments.
export async function createCapacitorConnection(
  name: string,
  opts: DBConnectionOptions = {},
): Promise<IDBConnection> {
  const { createCapacitorConnection: factory } = await import('./drivers/create-capacitor.js');
  return factory(name, opts);
}
