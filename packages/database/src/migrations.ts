import type { IDBConnection } from './connection.js';
import { INIT_SQL } from './migrations/init.js';

export async function runMigrations(conn: IDBConnection): Promise<void> {
  // Create migrations tracking table
  await conn.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now', 'utc'))
    )
  `);

  // Check if init migration has been applied
  const rows = await conn.query<{ id: string }>(
    `SELECT id FROM _migrations WHERE id = ?`,
    ['001_init'],
  );

  if (rows.length > 0) {
    return; // Already applied
  }

  // Split INIT_SQL on semicolons and run as transaction
  const statements = INIT_SQL
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const ops = statements.map((sql) => ({ sql }));
  await conn.transaction(ops);

  // Record migration
  await conn.run(
    `INSERT INTO _migrations (id) VALUES (?)`,
    ['001_init'],
  );
}
