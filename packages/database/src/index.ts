export type { IDBConnection, DBConnectionOptions, DBConnectionFactory } from './connection.js';
export { runMigrations } from './migrations.js';
export { WebDBConnection } from './drivers/web.js';
export { createQueries } from './queries.js';
export type { Queries } from './queries.js';

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
