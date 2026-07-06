import type { IDBConnection } from '@ledger/database';
import type { SyncedTable, WireRow } from '../protocol/messages.js';

export const BATCH_SIZE = 500;

interface TableSpec {
  table: SyncedTable;
  pk: string;
  /** Explicit column list — ledgers deliberately excludes balance. */
  columns: string[];
}

const COMMON = ['status', 'created_at', 'updated_at', 'version_hlc', 'origin_device_id'];

export const SYNC_TABLES: ReadonlyArray<TableSpec> = [
  {
    table: 'books',
    pk: 'book_id',
    columns: ['book_id', 'name', 'is_closed', 'is_balanced', 'is_auto_open', ...COMMON],
  },
  {
    table: 'ledgers',
    pk: 'ledger_id',
    columns: ['ledger_id', 'book_id', 'ledger_name', 'icon', 'ledger_color', 'alias', ...COMMON],
  },
  {
    table: 'entries',
    pk: 'entry_id',
    columns: [
      'entry_id',
      'ledger_id',
      'book_id',
      'entry_date',
      'detail',
      'amount',
      'cat_direction',
      'transfer_group_id',
      ...COMMON,
    ],
  },
];

export function tableSpec(table: SyncedTable): TableSpec {
  const spec = SYNC_TABLES.find((t) => t.table === table);
  if (!spec) throw new Error(`Unknown synced table: ${table}`);
  return spec;
}

/** The sender's snapshot bound, captured at sync_begin. */
export async function getMaxSeq(conn: IDBConnection): Promise<number> {
  const rows = await conn.query<{ m: number | null }>(
    `SELECT COALESCE(MAX(seq), 0) AS m FROM sync_change_log`,
  );
  return rows[0]?.m ?? 0;
}

/**
 * DESIGN §2.4 safety net: any row that a mutation path forgot to stamp gets a
 * version derived from its timestamps before it is collected. Warns in dev —
 * a hit here means a write path is missing syncStamp().
 */
export async function stampUnstampedRows(conn: IDBConnection, deviceId: string): Promise<void> {
  const expr = `printf('%015d', CAST(strftime('%s', COALESCE(updated_at, created_at)) AS INTEGER) * 1000) || '-0000-' || substr(?, 1, 8)`;
  let total = 0;
  for (const { table } of SYNC_TABLES) {
    const res = await conn.run(
      `UPDATE ${table} SET version_hlc = ${expr}, origin_device_id = ? WHERE version_hlc IS NULL`,
      [deviceId, deviceId],
    );
    total += res.changes ?? 0;
  }
  if (total > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[sync] stamped ${total} rows lazily — a mutation path is missing syncStamp()`);
  }
}

/**
 * Collect the rows of one table changed in (cursor, snapshot], in log order.
 * Echo suppression (skip rows the receiving peer itself wrote) is an
 * optimization only — correctness never depends on it.
 */
export async function collectTableChanges(
  conn: IDBConnection,
  table: SyncedTable,
  cursor: number,
  snapshotSeq: number,
  excludePeerDeviceId?: string,
): Promise<WireRow[]> {
  const spec = tableSpec(table);
  const cols = spec.columns.map((c) => `r.${c}`).join(', ');
  const echoFilter = excludePeerDeviceId ? `AND r.origin_device_id != ?` : '';
  const params: unknown[] = [table, cursor, snapshotSeq];
  if (excludePeerDeviceId) params.push(excludePeerDeviceId);
  return conn.query<WireRow>(
    `SELECT ${cols}
     FROM sync_change_log l
     JOIN ${table} r ON l.row_id = r.${spec.pk}
     WHERE l.table_name = ? AND l.seq > ? AND l.seq <= ? ${echoFilter}
     ORDER BY l.seq`,
    params,
  );
}

export function chunkRows<T>(rows: T[], size: number = BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}
