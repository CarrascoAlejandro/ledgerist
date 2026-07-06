import type { IDBConnection } from './connection.js';
import { migration001Init } from './migrations/001_init.js';
import { migration002Sync } from './migrations/002_sync.js';
import { initSyncContext } from './syncContextInit.js';

export interface Migration {
  id: string;
  up(conn: IDBConnection): Promise<void>;
}

export const MIGRATIONS: Migration[] = [migration001Init, migration002Sync];

export async function runMigrations(
  conn: IDBConnection,
  migrations: Migration[] = MIGRATIONS,
): Promise<void> {
  // Create migrations tracking table
  await conn.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now', 'utc'))
    )
  `);

  for (const migration of migrations) {
    const rows = await conn.query<{ id: string }>(
      `SELECT id FROM _migrations WHERE id = ?`,
      [migration.id],
    );
    if (rows.length > 0) continue; // Already applied

    await migration.up(conn);
    await conn.run(`INSERT OR IGNORE INTO _migrations (id) VALUES (?)`, [migration.id]);
  }

  // Seed the process-wide sync context once the schema is current. Skipped
  // when running a partial list that stops before 002_sync (upgrade tests).
  if (migrations.some((m) => m.id === migration002Sync.id)) {
    await initSyncContext(conn);
  }
}
