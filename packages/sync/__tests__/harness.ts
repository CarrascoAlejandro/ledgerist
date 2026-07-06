/**
 * Multi-device test harness: hosts N independent "devices" (in-memory sql.js
 * DBs + their own HLC/device identity) in one process by swapping the global
 * DB singleton and sync context around real Zustand store mutations.
 */
import fs from 'fs';
import path from 'path';
import { HLC, getSyncContext, setSyncContext } from '@ledger/shared';
import type { SyncContext, Ledger } from '@ledger/shared';
import { WebDBConnection, runMigrations } from '@ledger/database';
import type { IDBConnection } from '@ledger/database';
import { useBookStore, useLedgerStore, useEntryStore, setDB } from '@ledger/stores';
import { SyncEngine } from '../src/engine/SyncEngine.js';
import { SYNC_TABLES } from '../src/engine/collector.js';
import { upsertPeer } from '../src/engine/peers.js';
import { createLoopbackPair } from '../src/transport/loopback.js';
import { decodeMessage } from '../src/protocol/codec.js';
import type { SyncMessage, SyncSessionResult } from '../src/index.js';

export interface TestDevice {
  label: string;
  conn: IDBConnection;
  ctx: SyncContext;
  deviceId: string;
  engine: SyncEngine;
}

export async function createDevice(
  label: string,
  opts: { clockOffsetMs?: number } = {},
): Promise<TestDevice> {
  const wasmPath = path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: initSqlJs } = (await import('sql.js')) as any;
  const SQL = await initSqlJs({ wasmBinary });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDb: any = new SQL.Database();
  rawDb.run('PRAGMA foreign_keys = ON');
  const conn = new WebDBConnection(rawDb, label, false);
  await runMigrations(conn); // seeds the global sync context for THIS device

  let ctx = getSyncContext();
  if (opts.clockOffsetMs !== undefined) {
    const offset = opts.clockOffsetMs;
    const hlc = new HLC(ctx.deviceId, () => Date.now() + offset);
    hlc.seed(null);
    ctx = { deviceId: ctx.deviceId, hlc };
    setSyncContext(ctx);
  }

  return {
    label,
    conn,
    ctx,
    deviceId: ctx.deviceId,
    engine: new SyncEngine({ conn, hlc: ctx.hlc, deviceId: ctx.deviceId }),
  };
}

/** Pair two devices in both directions (6b has no crypto — dummy key). */
export async function pairDevices(a: TestDevice, b: TestDevice): Promise<void> {
  await upsertPeer(a.conn, {
    peer_device_id: b.deviceId,
    peer_name: b.label,
    shared_key: 'test',
  });
  await upsertPeer(b.conn, {
    peer_device_id: a.deviceId,
    peer_name: a.label,
    shared_key: 'test',
  });
}

function resetStores(): void {
  useBookStore.setState({ books: [], currentBook: null, loading: false, error: null });
  useLedgerStore.setState({
    ledgers: [],
    currentBook_id: null,
    collapsed: {},
    loading: false,
    error: null,
  });
  useEntryStore.setState({
    entries: [],
    currentBook_id: null,
    parserInput: '',
    parserPreview: null,
    loading: false,
    error: null,
  });
}

/**
 * Activate a device (DB singleton + sync context + clean store state) and run
 * real store-level mutations against it.
 */
export async function withDevice<T>(
  device: TestDevice,
  fn: () => Promise<T>,
): Promise<T> {
  setDB(device.conn);
  setSyncContext(device.ctx);
  resetStores();
  await useBookStore.getState().fetchBooks();
  try {
    return await fn();
  } finally {
    resetStores();
  }
}

/** Load a book's ledgers + entries into store state (required before entry ops). */
export async function loadBook(book_id: string): Promise<void> {
  await useLedgerStore.getState().fetchLedgers(book_id);
  await useEntryStore.getState().fetchEntriesForBook(book_id);
}

/** Build the preview object submitParsedEntry needs to create a transfer. */
export function transferPreview(amount: number, source: Ledger, target: Ledger) {
  return {
    raw: `transfer ${amount} #${source.ledger_name} to #${target.ledger_name}`,
    parsed_date: null,
    parsed_ledger: source,
    parsed_amount: amount,
    parsed_direction: null,
    parsed_detail: null,
    is_transfer: true,
    resolved_transfer_target: target,
    errors: [],
    warnings: [],
  };
}

export interface SyncPairResult {
  initiator: SyncSessionResult;
  responder: SyncSessionResult;
  messages: { fromInitiator: SyncMessage[]; fromResponder: SyncMessage[] };
}

/**
 * Run one full session between two devices over a loopback pair.
 * `failAfterSends` injects a connection drop after the n-th frame from either
 * side; the returned promise then rejects for both engines.
 */
export async function syncPair(
  initiator: TestDevice,
  responder: TestDevice,
  opts: { failAfterSends?: { initiator?: number; responder?: number } } = {},
): Promise<SyncPairResult> {
  const [chI, chR] = createLoopbackPair();
  if (opts.failAfterSends?.initiator !== undefined) {
    chI.failAfterSends(opts.failAfterSends.initiator);
  }
  if (opts.failAfterSends?.responder !== undefined) {
    chR.failAfterSends(opts.failAfterSends.responder);
  }

  // Message taps for assertions (echo suppression, empty deltas).
  const fromInitiator: SyncMessage[] = [];
  const fromResponder: SyncMessage[] = [];
  const tap = (ch: (typeof chI), sink: SyncMessage[]) => {
    const orig = ch.send.bind(ch);
    ch.send = async (frame: Uint8Array) => {
      try {
        sink.push(decodeMessage(frame));
      } catch {
        /* non-protocol frame — ignore */
      }
      return orig(frame);
    };
  };
  tap(chI, fromInitiator);
  tap(chR, fromResponder);

  const [initiatorResult, responderResult] = await Promise.all([
    initiator.engine.initiate(chI, responder.deviceId),
    responder.engine.respond(chR, initiator.deviceId),
  ]);
  return {
    initiator: initiatorResult,
    responder: responderResult,
    messages: { fromInitiator, fromResponder },
  };
}

/** All synced columns (incl. version fields), ordered by PK — balance excluded by construction. */
export async function dumpTables(
  conn: IDBConnection,
): Promise<Record<string, unknown[]>> {
  const dump: Record<string, unknown[]> = {};
  for (const spec of SYNC_TABLES) {
    dump[spec.table] = await conn.query(
      `SELECT ${spec.columns.join(', ')} FROM ${spec.table} ORDER BY ${spec.pk}`,
    );
  }
  return dump;
}

export async function expectConverged(devices: TestDevice[]): Promise<void> {
  const dumps = await Promise.all(devices.map((d) => dumpTables(d.conn)));
  for (let i = 1; i < dumps.length; i++) {
    expect(dumps[i]).toEqual(dumps[0]);
  }
}

/** Every active ledger's stored balance must equal the SUM over its active entries. */
export async function expectBalancesCorrect(device: TestDevice): Promise<void> {
  const rows = await device.conn.query<{ ledger_id: string; balance: number; computed: number }>(
    `SELECT l.ledger_id, l.balance,
            COALESCE((SELECT SUM(CASE e.cat_direction WHEN 'add' THEN e.amount ELSE -e.amount END)
                      FROM entries e WHERE e.ledger_id = l.ledger_id AND e.status = 1), 0) AS computed
     FROM ledgers l WHERE l.status = 1`,
  );
  for (const row of rows) {
    expect({ ledger: row.ledger_id, balance: row.balance }).toEqual({
      ledger: row.ledger_id,
      balance: row.computed,
    });
  }
}

/** Count data rows in the 'changes' messages of a tap. */
export function changedRowCount(messages: SyncMessage[]): number {
  return messages
    .filter((m): m is Extract<SyncMessage, { type: 'changes' }> => m.type === 'changes')
    .reduce((acc, m) => acc + m.rows.length, 0);
}
