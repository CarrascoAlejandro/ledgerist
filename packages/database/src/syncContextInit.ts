import { HLC, setSyncContext } from '@ledger/shared';
import type { SyncContext } from '@ledger/shared';
import type { IDBConnection } from './connection.js';

/**
 * Seeds the process-wide sync context (device id + HLC) from the database.
 * Runs at the end of runMigrations(), so every shell entrypoint and test
 * helper gets a working stamp context with no call-site changes.
 */
export async function initSyncContext(conn: IDBConnection): Promise<SyncContext> {
  const rows = await conn.query<{ device_id: string }>(
    `SELECT device_id FROM sync_local WHERE id = 1`,
  );
  if (rows.length === 0) {
    throw new Error('sync_local not seeded — did migration 002_sync run?');
  }
  const deviceId = rows[0].device_id;

  const maxRows = await conn.query<{ m: string | null }>(
    `SELECT MAX(m) AS m FROM (
       SELECT MAX(version_hlc) AS m FROM books
       UNION ALL SELECT MAX(version_hlc) FROM ledgers
       UNION ALL SELECT MAX(version_hlc) FROM entries
     )`,
  );

  const hlc = new HLC(deviceId);
  hlc.seed(maxRows[0]?.m ?? null);

  const ctx: SyncContext = { deviceId, hlc };
  setSyncContext(ctx);
  return ctx;
}
