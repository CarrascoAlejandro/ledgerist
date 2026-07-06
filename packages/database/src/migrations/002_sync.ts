import type { Migration } from '../migrations.js';
import type { DBOperation } from '../connection.js';

const SYNCED_TABLES: Array<{ table: string; pk: string }> = [
  { table: 'books', pk: 'book_id' },
  { table: 'ledgers', pk: 'ledger_id' },
  { table: 'entries', pk: 'entry_id' },
];

function detectDeviceName(): string {
  if (typeof window === 'undefined') return 'Desktop'; // Electron main / Node
  const w = window as { electronAPI?: unknown; Capacitor?: { isNativePlatform?: () => boolean } };
  if (w.Capacitor?.isNativePlatform?.()) return 'Android';
  if (w.electronAPI) return 'Desktop';
  return 'Browser';
}

// Encodes updated_at ?? created_at ('YYYY-MM-DD HH:MM:SS' UTC) as a
// counter-zero HLC so pre-sync rows order sensibly against future edits.
const BACKFILL_HLC_EXPR = `printf('%015d', CAST(strftime('%s', COALESCE(updated_at, created_at)) AS INTEGER) * 1000) || '-0000-' || substr(?, 1, 8)`;

export const migration002Sync: Migration = {
  id: '002_sync',
  async up(conn) {
    const deviceId = crypto.randomUUID();
    const deviceName = detectDeviceName();
    const ops: DBOperation[] = [];

    // 1. Version columns + indexes on synced tables.
    for (const { table } of SYNCED_TABLES) {
      ops.push({ sql: `ALTER TABLE \`${table}\` ADD COLUMN \`version_hlc\` TEXT` });
      ops.push({ sql: `ALTER TABLE \`${table}\` ADD COLUMN \`origin_device_id\` TEXT` });
      ops.push({
        sql: `CREATE INDEX IF NOT EXISTS \`idx_${table}_version_hlc\` ON \`${table}\` (\`version_hlc\`)`,
      });
    }

    // 2. Sync metadata tables.
    ops.push({
      sql: `CREATE TABLE IF NOT EXISTS \`sync_local\` (
        \`id\` INTEGER PRIMARY KEY CHECK (\`id\` = 1),
        \`device_id\` TEXT NOT NULL,
        \`device_name\` TEXT NOT NULL,
        \`created_at\` TEXT DEFAULT (datetime('now','utc'))
      )`,
    });
    ops.push({
      sql: `CREATE TABLE IF NOT EXISTS \`sync_peers\` (
        \`peer_device_id\` TEXT PRIMARY KEY,
        \`peer_name\` TEXT NOT NULL,
        \`shared_key\` TEXT NOT NULL,
        \`last_address\` TEXT,
        \`applied_through_seq\` INTEGER NOT NULL DEFAULT 0,
        \`acked_through_seq\` INTEGER NOT NULL DEFAULT 0,
        \`last_synced_at\` TEXT,
        \`paired_at\` TEXT DEFAULT (datetime('now','utc')),
        \`status\` INTEGER DEFAULT 1 CHECK (\`status\` IN (0, 1))
      )`,
    });
    ops.push({
      sql: `CREATE TABLE IF NOT EXISTS \`sync_change_log\` (
        \`seq\` INTEGER PRIMARY KEY AUTOINCREMENT,
        \`table_name\` TEXT NOT NULL,
        \`row_id\` TEXT NOT NULL,
        UNIQUE(\`table_name\`, \`row_id\`)
      )`,
    });
    ops.push({
      sql: `CREATE TABLE IF NOT EXISTS \`sync_conflicts\` (
        \`conflict_id\` TEXT PRIMARY KEY,
        \`kind\` TEXT NOT NULL CHECK (\`kind\` IN ('lww','unique_name','unique_alias','transfer_repair')),
        \`table_name\` TEXT NOT NULL,
        \`row_id\` TEXT NOT NULL,
        \`peer_device_id\` TEXT NOT NULL,
        \`winner\` TEXT NOT NULL CHECK (\`winner\` IN ('local','remote')),
        \`loser_snapshot\` TEXT NOT NULL,
        \`resolved_at\` TEXT DEFAULT (datetime('now','utc')),
        \`seen\` INTEGER DEFAULT 0 CHECK (\`seen\` IN (0, 1))
      )`,
    });

    // 3. Device identity.
    ops.push({
      sql: `INSERT INTO \`sync_local\` (\`id\`, \`device_id\`, \`device_name\`) VALUES (1, ?, ?)`,
      params: [deviceId, deviceName],
    });

    // 4. Backfill versions, then seed the change log, then create triggers —
    // strictly in that order: triggers created earlier would log the backfill
    // UPDATEs and collide with the seed's UNIQUE(table_name, row_id).
    for (const { table } of SYNCED_TABLES) {
      ops.push({
        sql: `UPDATE \`${table}\` SET \`version_hlc\` = ${BACKFILL_HLC_EXPR}, \`origin_device_id\` = ? WHERE \`version_hlc\` IS NULL`,
        params: [deviceId, deviceId],
      });
    }
    for (const { table, pk } of SYNCED_TABLES) {
      ops.push({
        sql: `INSERT INTO \`sync_change_log\` (\`table_name\`, \`row_id\`) SELECT '${table}', \`${pk}\` FROM \`${table}\``,
      });
    }

    // 5. Change-log triggers. DELETE-then-INSERT (not UPSERT) so AUTOINCREMENT
    // hands every change a seq strictly greater than any ever issued —
    // compaction only moves rows UP, which is what makes table-ordered delta
    // batches FK-safe (DESIGN §5.3). Each trigger is ONE statement; never run
    // these through a naive split-on-';'.
    for (const { table, pk } of SYNCED_TABLES) {
      for (const [suffix, event] of [
        ['ins', 'INSERT'],
        ['upd', 'UPDATE'],
      ] as const) {
        ops.push({
          sql: `CREATE TRIGGER IF NOT EXISTS \`trg_${table}_changelog_${suffix}\` AFTER ${event} ON \`${table}\` BEGIN
            DELETE FROM \`sync_change_log\` WHERE \`table_name\` = '${table}' AND \`row_id\` = NEW.\`${pk}\`;
            INSERT INTO \`sync_change_log\` (\`table_name\`, \`row_id\`) VALUES ('${table}', NEW.\`${pk}\`);
          END`,
        });
      }
    }

    await conn.transaction(ops);
  },
};
