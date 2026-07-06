import type { IDBConnection } from '@ledger/database';

export type ConflictKind = 'lww' | 'unique_name' | 'unique_alias' | 'transfer_repair';

export interface SyncConflict {
  conflict_id: string;
  kind: ConflictKind;
  table_name: string;
  row_id: string;
  peer_device_id: string;
  winner: 'local' | 'remote';
  loser_snapshot: string;
  resolved_at: string;
  seen: 0 | 1;
}

export async function listConflicts(conn: IDBConnection, limit = 200): Promise<SyncConflict[]> {
  return conn.query<SyncConflict>(
    `SELECT * FROM sync_conflicts ORDER BY resolved_at DESC, conflict_id DESC LIMIT ?`,
    [limit],
  );
}

export async function countUnseenConflicts(conn: IDBConnection): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sync_conflicts WHERE seen = 0`,
  );
  return rows[0]?.n ?? 0;
}

export async function markConflictsSeen(conn: IDBConnection): Promise<void> {
  await conn.run(`UPDATE sync_conflicts SET seen = 1 WHERE seen = 0`);
}

export async function renameDevice(conn: IDBConnection, name: string): Promise<void> {
  await conn.run(`UPDATE sync_local SET device_name = ? WHERE id = 1`, [name]);
}
