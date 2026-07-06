/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import { getSyncContext, hasSyncContext, parseHlc, setSyncContext, HLC } from '@ledger/shared';
import {
  WebDBConnection,
  runMigrations,
  createQueries,
  buildOps,
  syncStamp,
} from '../src/index.js';
import { migration001Init } from '../src/migrations/001_init.js';
import type { IDBConnection } from '../src/index.js';
import type { Queries } from '../src/index.js';

async function createRawDB(): Promise<IDBConnection> {
  const wasmPath = path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: initSqlJs } = await import('sql.js') as any;
  const SQL = await initSqlJs({ wasmBinary });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDb: any = new SQL.Database();
  rawDb.run('PRAGMA foreign_keys = ON');
  return new WebDBConnection(rawDb, 'test', false);
}

async function createTestDB(): Promise<IDBConnection> {
  const conn = await createRawDB();
  await runMigrations(conn);
  return conn;
}

interface ChangeLogRow {
  seq: number;
  table_name: string;
  row_id: string;
}

async function changeLog(conn: IDBConnection): Promise<ChangeLogRow[]> {
  return conn.query<ChangeLogRow>(
    `SELECT seq, table_name, row_id FROM sync_change_log ORDER BY seq`,
  );
}

async function logRowFor(conn: IDBConnection, table: string, rowId: string) {
  const rows = await conn.query<ChangeLogRow>(
    `SELECT seq, table_name, row_id FROM sync_change_log WHERE table_name = ? AND row_id = ?`,
    [table, rowId],
  );
  return rows[0] ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('migration 002_sync — fresh database', () => {
  let conn: IDBConnection;

  beforeEach(async () => {
    conn = await createTestDB();
  });
  afterEach(async () => {
    await conn.close();
  });

  it('records both migrations and seeds device identity', async () => {
    const migs = await conn.query<{ id: string }>(`SELECT id FROM _migrations ORDER BY id`);
    expect(migs.map((m) => m.id)).toEqual(['001_init', '002_sync']);

    const local = await conn.query<{ id: number; device_id: string; device_name: string }>(
      `SELECT id, device_id, device_name FROM sync_local`,
    );
    expect(local).toHaveLength(1);
    expect(local[0].id).toBe(1);
    expect(local[0].device_id).toMatch(UUID_RE);
    expect(local[0].device_name.length).toBeGreaterThan(0);
  });

  it('is idempotent — re-running is a no-op with the same device id', async () => {
    const before = await conn.query<{ device_id: string }>(`SELECT device_id FROM sync_local`);
    await runMigrations(conn);
    const after = await conn.query<{ device_id: string }>(`SELECT device_id FROM sync_local`);
    expect(after).toEqual(before);
  });

  it('seeds the sync context with the device id', async () => {
    const ctx = getSyncContext();
    const local = await conn.query<{ device_id: string }>(`SELECT device_id FROM sync_local`);
    expect(ctx.deviceId).toBe(local[0].device_id);
  });
});

describe('migration 002_sync — upgrade path with pre-existing data', () => {
  it('backfills versions and seeds one change-log row per row', async () => {
    const conn = await createRawDB();
    // Legacy database: only 001 applied, rows created without sync columns.
    await runMigrations(conn, [migration001Init]);
    await conn.run(
      `INSERT INTO books (book_id, name, status, created_at, updated_at)
       VALUES ('b1', 'Legacy', 1, '2024-01-10 08:30:00', '2024-06-01 12:00:00')`,
    );
    await conn.run(
      `INSERT INTO ledgers (ledger_id, book_id, ledger_name, icon, balance, status, created_at)
       VALUES ('l1', 'b1', 'Cash', '💰', 0, 1, '2024-01-11 09:00:00')`,
    );
    await conn.run(
      `INSERT INTO entries (entry_id, ledger_id, book_id, entry_date, amount, cat_direction, status, created_at)
       VALUES ('e1', 'l1', 'b1', '2024-01-12', 50, 'sub', 1, '2024-01-12 10:00:00')`,
    );

    await runMigrations(conn); // applies 002_sync

    const device = (await conn.query<{ device_id: string }>(`SELECT device_id FROM sync_local`))[0]
      .device_id;
    const device8 = device.slice(0, 8);

    const book = (
      await conn.query<{ version_hlc: string; origin_device_id: string }>(
        `SELECT version_hlc, origin_device_id FROM books WHERE book_id = 'b1'`,
      )
    )[0];
    // updated_at (2024-06-01 12:00:00 UTC) wins over created_at
    const expectedMs = Date.parse('2024-06-01T12:00:00Z');
    expect(book.version_hlc).toBe(`${String(expectedMs).padStart(15, '0')}-0000-${device8}`);
    expect(book.origin_device_id).toBe(device);

    const ledger = (
      await conn.query<{ version_hlc: string }>(
        `SELECT version_hlc FROM ledgers WHERE ledger_id = 'l1'`,
      )
    )[0];
    // no updated_at → created_at
    const ledgerMs = Date.parse('2024-01-11T09:00:00Z');
    expect(parseHlc(ledger.version_hlc).physical).toBe(ledgerMs);

    const log = await changeLog(conn);
    expect(log).toHaveLength(3);
    expect(log.map((r) => `${r.table_name}:${r.row_id}`).sort()).toEqual([
      'books:b1',
      'entries:e1',
      'ledgers:l1',
    ]);

    await conn.close();
  });
});

describe('change-log triggers', () => {
  let conn: IDBConnection;
  let q: Queries;

  beforeEach(async () => {
    conn = await createTestDB();
    q = createQueries(conn);
  });
  afterEach(async () => {
    await conn.close();
  });

  it('fire for every createQueries mutation path', async () => {
    await q.insertBook('b1', 'Book');
    expect(await logRowFor(conn, 'books', 'b1')).not.toBeNull();

    await q.insertLedger('l1', 'b1', 'Cash', '💰');
    expect(await logRowFor(conn, 'ledgers', 'l1')).not.toBeNull();

    await q.insertEntry('e1', {
      ledger_id: 'l1',
      book_id: 'b1',
      entry_date: '2024-01-01',
      detail: null,
      amount: 10,
      cat_direction: 'sub',
      transfer_group_id: null,
    });
    expect(await logRowFor(conn, 'entries', 'e1')).not.toBeNull();

    const before = (await logRowFor(conn, 'books', 'b1'))!.seq;
    await q.updateBookName('b1', 'Renamed');
    const after = (await logRowFor(conn, 'books', 'b1'))!.seq;
    expect(after).toBeGreaterThan(before);
  });

  it('fire for store-composed transactions (buildOps)', async () => {
    await q.insertBook('b1', 'Book');
    await q.insertLedger('l1', 'b1', 'Cash', '💰');
    await conn.transaction([
      buildOps.insertEntry('e1', {
        ledger_id: 'l1',
        book_id: 'b1',
        entry_date: '2024-01-01',
        detail: null,
        amount: 10,
        cat_direction: 'sub',
        transfer_group_id: null,
      }),
      buildOps.updateLedgerBalance('l1', -10),
    ]);
    expect(await logRowFor(conn, 'entries', 'e1')).not.toBeNull();
  });

  it('compact: repeated updates keep one row per (table, row) with strictly increasing seq', async () => {
    await q.insertBook('b1', 'Book');
    const seqs: number[] = [(await logRowFor(conn, 'books', 'b1'))!.seq];
    for (const name of ['A', 'B', 'C']) {
      await q.updateBookName('b1', name);
      seqs.push((await logRowFor(conn, 'books', 'b1'))!.seq);
    }
    const rows = await conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sync_change_log WHERE table_name = 'books' AND row_id = 'b1'`,
    );
    expect(rows[0].n).toBe(1);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it('AUTOINCREMENT never reuses a seq after compaction deletes', async () => {
    await q.insertBook('b1', 'Book1');
    await q.insertBook('b2', 'Book2');
    await q.updateBookName('b1', 'X'); // deletes+reinserts b1's log row
    await q.updateBookName('b2', 'Y');
    const log = await changeLog(conn);
    const allSeqs = log.map((r) => r.seq);
    expect(new Set(allSeqs).size).toBe(allSeqs.length);
    // b2's latest change must have the max seq
    expect(log[log.length - 1].row_id).toBe('b2');
  });
});

describe('HLC stamping', () => {
  let conn: IDBConnection;
  let q: Queries;

  beforeEach(async () => {
    conn = await createTestDB();
    q = createQueries(conn);
  });
  afterEach(async () => {
    await conn.close();
  });

  async function hlcOf(table: string, pk: string, id: string): Promise<string> {
    const rows = await conn.query<{ version_hlc: string | null }>(
      `SELECT version_hlc FROM ${table} WHERE ${pk} = ?`,
      [id],
    );
    expect(rows[0].version_hlc).not.toBeNull();
    return rows[0].version_hlc!;
  }

  it('every content mutation writes a fresh, strictly increasing version with the local device id', async () => {
    const device8 = getSyncContext().deviceId.slice(0, 8);
    const stamps: string[] = [];

    await q.insertBook('b1', 'Book');
    stamps.push(await hlcOf('books', 'book_id', 'b1'));
    await q.updateBookName('b1', 'R');
    stamps.push(await hlcOf('books', 'book_id', 'b1'));
    await q.setBookClosed('b1', 1);
    stamps.push(await hlcOf('books', 'book_id', 'b1'));
    await q.setBookClosed('b1', 0);
    await q.setBookAutoOpen('b1', 1);
    stamps.push(await hlcOf('books', 'book_id', 'b1'));
    await q.setBookBalanced('b1', 1);
    stamps.push(await hlcOf('books', 'book_id', 'b1'));

    await q.insertLedger('l1', 'b1', 'Cash', '💰');
    stamps.push(await hlcOf('ledgers', 'ledger_id', 'l1'));
    await q.updateLedgerName('l1', 'Wallet');
    stamps.push(await hlcOf('ledgers', 'ledger_id', 'l1'));
    await q.updateLedgerColor('l1', '#fff');
    stamps.push(await hlcOf('ledgers', 'ledger_id', 'l1'));
    await q.updateLedgerIcon('l1', '🪙');
    stamps.push(await hlcOf('ledgers', 'ledger_id', 'l1'));
    await q.updateLedgerAlias('l1', 'cash');
    stamps.push(await hlcOf('ledgers', 'ledger_id', 'l1'));

    await q.insertEntry('e1', {
      ledger_id: 'l1',
      book_id: 'b1',
      entry_date: '2024-01-01',
      detail: null,
      amount: 10,
      cat_direction: 'sub',
      transfer_group_id: null,
    });
    stamps.push(await hlcOf('entries', 'entry_id', 'e1'));
    await q.updateEntryFields('e1', { amount: 20, detail: 'x' });
    stamps.push(await hlcOf('entries', 'entry_id', 'e1'));
    await q.softDeleteEntry('e1');
    stamps.push(await hlcOf('entries', 'entry_id', 'e1'));
    await q.softDeleteLedger('l1');
    stamps.push(await hlcOf('ledgers', 'ledger_id', 'l1'));
    await q.softDeleteBook('b1');
    stamps.push(await hlcOf('books', 'book_id', 'b1'));

    for (const s of stamps) {
      expect(parseHlc(s).device).toBe(device8);
    }
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i] > stamps[i - 1]).toBe(true);
    }
  });

  it('balance-only ledger updates do NOT bump version_hlc', async () => {
    await q.insertBook('b1', 'Book');
    await q.insertLedger('l1', 'b1', 'Cash', '💰');
    const before = await hlcOf('ledgers', 'ledger_id', 'l1');
    await q.updateLedgerBalance('l1', 123);
    const after = await hlcOf('ledgers', 'ledger_id', 'l1');
    expect(after).toBe(before);
  });

  it('updateEntryFields with no fields is still a no-op', async () => {
    await q.insertBook('b1', 'Book');
    await q.insertLedger('l1', 'b1', 'Cash', '💰');
    await q.insertEntry('e1', {
      ledger_id: 'l1',
      book_id: 'b1',
      entry_date: '2024-01-01',
      detail: null,
      amount: 10,
      cat_direction: 'sub',
      transfer_group_id: null,
    });
    const before = await hlcOf('entries', 'entry_id', 'e1');
    await q.updateEntryFields('e1', {});
    expect(await hlcOf('entries', 'entry_id', 'e1')).toBe(before);
    expect(buildOps.updateEntryFields('e1', {})).toBeNull();
  });

  it('cascade soft-deletes stamp every affected row', async () => {
    await q.insertBook('b1', 'Book');
    await q.insertLedger('l1', 'b1', 'Cash', '💰');
    await q.insertLedger('l2', 'b1', 'Bank', '🏦');
    const l1Before = await hlcOf('ledgers', 'ledger_id', 'l1');
    const l2Before = await hlcOf('ledgers', 'ledger_id', 'l2');
    await q.softDeleteLedgersByBook('b1');
    expect(await hlcOf('ledgers', 'ledger_id', 'l1')).not.toBe(l1Before);
    expect(await hlcOf('ledgers', 'ledger_id', 'l2')).not.toBe(l2Before);
  });
});

describe('syncStamp guard', () => {
  it('throws a descriptive error when the context is unset', () => {
    const saved = hasSyncContext() ? getSyncContext() : null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setSyncContext(null as any);
      expect(() => syncStamp()).toThrow('Sync context not initialized');
    } finally {
      if (saved) setSyncContext(saved);
    }
  });

  it('stamps come from the active context (settable for multi-device tests)', () => {
    const saved = hasSyncContext() ? getSyncContext() : null;
    try {
      const hlc = new HLC('deadbeef-0000-0000-0000-000000000000', () => 42);
      setSyncContext({ deviceId: 'deadbeef-0000-0000-0000-000000000000', hlc });
      const [stamp, device] = syncStamp();
      expect(device).toBe('deadbeef-0000-0000-0000-000000000000');
      expect(parseHlc(stamp)).toMatchObject({ physical: 42, counter: 0, device: 'deadbeef' });
    } finally {
      if (saved) setSyncContext(saved);
    }
  });
});
