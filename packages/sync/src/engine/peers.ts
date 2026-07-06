import type { DBOperation, IDBConnection } from '@ledger/database';

export interface LocalDevice {
  device_id: string;
  device_name: string;
}

export interface SyncPeer {
  peer_device_id: string;
  peer_name: string;
  shared_key: string;
  last_address: string | null;
  /** Cursor into THAT PEER's change log: highest seq we have fully applied. */
  applied_through_seq: number;
  /** Highest seq of OUR OWN change log the peer has acknowledged applying. */
  acked_through_seq: number;
  last_synced_at: string | null;
  paired_at: string;
  status: 0 | 1;
}

export async function getLocalDevice(conn: IDBConnection): Promise<LocalDevice> {
  const rows = await conn.query<LocalDevice>(
    `SELECT device_id, device_name FROM sync_local WHERE id = 1`,
  );
  if (rows.length === 0) {
    throw new Error('sync_local not seeded — did migration 002_sync run?');
  }
  return rows[0];
}

export async function getPeer(
  conn: IDBConnection,
  peerDeviceId: string,
): Promise<SyncPeer | null> {
  const rows = await conn.query<SyncPeer>(
    `SELECT * FROM sync_peers WHERE peer_device_id = ?`,
    [peerDeviceId],
  );
  return rows[0] ?? null;
}

export async function listPeers(conn: IDBConnection): Promise<SyncPeer[]> {
  return conn.query<SyncPeer>(
    `SELECT * FROM sync_peers WHERE status = 1 ORDER BY paired_at ASC`,
  );
}

/** Pair (or re-pair: REPLACE resets key and cursor, per DESIGN §4). */
export async function upsertPeer(
  conn: IDBConnection,
  peer: {
    peer_device_id: string;
    peer_name: string;
    shared_key: string;
    last_address?: string | null;
  },
): Promise<void> {
  await conn.run(
    `INSERT OR REPLACE INTO sync_peers
       (peer_device_id, peer_name, shared_key, last_address, applied_through_seq, status)
     VALUES (?, ?, ?, ?, 0, 1)`,
    [peer.peer_device_id, peer.peer_name, peer.shared_key, peer.last_address ?? null],
  );
}

export async function setPeerStatus(
  conn: IDBConnection,
  peerDeviceId: string,
  status: 0 | 1,
): Promise<void> {
  await conn.run(`UPDATE sync_peers SET status = ? WHERE peer_device_id = ?`, [
    status,
    peerDeviceId,
  ]);
}

/** Cursor advance op — composed into the merge's final transaction. */
export function buildCursorUpdateOp(peerDeviceId: string, throughSeq: number): DBOperation {
  return {
    sql: `UPDATE sync_peers SET applied_through_seq = ?, last_synced_at = datetime('now','utc') WHERE peer_device_id = ?`,
    params: [throughSeq, peerDeviceId],
  };
}

/**
 * Record how far into OUR log the peer has acked. Used by the merge to tell
 * genuine concurrent edits (local row changed after the peer last saw our
 * state) from ordinary propagation. Losing this write under a crash only
 * means over-reporting conflicts — never data loss.
 */
export async function updateAckedThroughSeq(
  conn: IDBConnection,
  peerDeviceId: string,
  throughSeq: number,
): Promise<void> {
  await conn.run(`UPDATE sync_peers SET acked_through_seq = ? WHERE peer_device_id = ?`, [
    throughSeq,
    peerDeviceId,
  ]);
}
