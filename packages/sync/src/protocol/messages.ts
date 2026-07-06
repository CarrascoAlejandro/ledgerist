/**
 * Sync protocol v1 message types (docs/sync/DESIGN.md §4, §5).
 *
 * All messages travel as JSON inside binary WebSocket frames. Handshake and
 * pairing messages (`hello`/`challenge`/`auth`/`auth_ok`/`pair_request`/
 * `pair_accept`/`error`) are plaintext; everything after `auth_ok` is
 * encrypted by the SecureChannel (phase 6c). Byte fields inside JSON are
 * base64url strings.
 */

export const PROTOCOL_VERSION = 1;

export type SyncedTable = 'books' | 'ledgers' | 'entries';

export interface WireBook {
  book_id: string;
  name: string;
  is_closed: 0 | 1;
  is_balanced: 0 | 1;
  is_auto_open: 0 | 1;
  status: 0 | 1;
  created_at: string;
  updated_at: string | null;
  version_hlc: string;
  origin_device_id: string;
}

// Deliberately no `balance`: derived, device-local (DESIGN §6 post-pass B).
export interface WireLedger {
  ledger_id: string;
  book_id: string;
  ledger_name: string;
  icon: string;
  ledger_color: string | null;
  alias: string | null;
  status: 0 | 1;
  created_at: string;
  updated_at: string | null;
  version_hlc: string;
  origin_device_id: string;
}

export interface WireEntry {
  entry_id: string;
  ledger_id: string;
  book_id: string;
  entry_date: string;
  detail: string | null;
  amount: number;
  cat_direction: 'add' | 'sub';
  transfer_group_id: string | null;
  status: 0 | 1;
  created_at: string;
  updated_at: string | null;
  version_hlc: string;
  origin_device_id: string;
}

export type WireRow = WireBook | WireLedger | WireEntry;

export type SyncErrorCode =
  | 'unknown_peer'
  | 'protocol_version'
  | 'auth_failed'
  | 'pairing_failed'
  | 'pairing_expired'
  | 'bad_message'
  | 'internal';

export type SyncMessage =
  // ── Handshake (plaintext) ──
  | { type: 'hello'; v: number; device_id: string; nonce: string }
  | { type: 'challenge'; device_id: string; nonce: string }
  | { type: 'auth'; mac: string }
  | { type: 'auth_ok'; mac: string }
  // ── Pairing (plaintext, secret-proven) ──
  | { type: 'pair_request'; device_id: string; device_name: string; proof: string }
  | { type: 'pair_accept'; device_id: string; device_name: string; proof: string }
  | { type: 'unpair'; device_id: string }
  // ── Sync session (encrypted from 6c on) ──
  | { type: 'sync_begin'; cursor: number }
  | { type: 'changes'; table: SyncedTable; rows: WireRow[] }
  | { type: 'changes_done'; through_seq: number }
  | { type: 'apply_ack'; through_seq: number }
  | { type: 'sync_complete' }
  // ── Errors ──
  | { type: 'error'; code: SyncErrorCode; message?: string };

export type SyncMessageType = SyncMessage['type'];
