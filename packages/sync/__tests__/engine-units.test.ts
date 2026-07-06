/**
 * @jest-environment node
 *
 * Unit tests for the seams the convergence suite doesn't pin down directly:
 * collector bounds/ordering/chunking, loopback semantics, merge atomicity.
 */
import { getSyncContext } from '@ledger/shared';
import { createQueries } from '@ledger/database';
import {
  BATCH_SIZE,
  chunkRows,
  collectTableChanges,
  getMaxSeq,
  stampUnstampedRows,
} from '../src/engine/collector.js';
import { MergeSession } from '../src/engine/merge.js';
import { getPeer, upsertPeer } from '../src/engine/peers.js';
import { createLoopbackPair } from '../src/transport/loopback.js';
import type { WireBook } from '../src/protocol/messages.js';
import { createDevice } from './harness.js';
import type { TestDevice } from './harness.js';

jest.setTimeout(30_000);

describe('collector', () => {
  let d: TestDevice;

  beforeEach(async () => {
    d = await createDevice('collector');
  });
  afterEach(async () => {
    await d.conn.close();
  });

  it('respects cursor < seq <= snapshot bounds and log order', async () => {
    const q = createQueries(d.conn);
    await q.insertBook('b1', 'One');
    const afterFirst = await getMaxSeq(d.conn);
    await q.insertBook('b2', 'Two');
    await q.insertBook('b3', 'Three');
    const afterThird = await getMaxSeq(d.conn);
    await q.insertBook('b4', 'Four');

    const rows = (await collectTableChanges(
      d.conn,
      'books',
      afterFirst,
      afterThird,
    )) as WireBook[];
    expect(rows.map((r) => r.book_id)).toEqual(['b2', 'b3']);
  });

  it('ledger rows travel without balance', async () => {
    const q = createQueries(d.conn);
    await q.insertBook('b1', 'One');
    await q.insertLedger('l1', 'b1', 'Cash', '💰');
    await q.updateLedgerBalance('l1', 999);
    const rows = await collectTableChanges(d.conn, 'ledgers', 0, await getMaxSeq(d.conn));
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).not.toContain('balance');
  });

  it('echo suppression filters rows by origin device', async () => {
    const q = createQueries(d.conn);
    await q.insertBook('b1', 'Mine');
    await d.conn.run(
      `INSERT INTO books (book_id, name, status, version_hlc, origin_device_id) VALUES ('b2', 'Theirs', 1, '000000000000001-0000-abcd1234', 'peer-device')`,
    );
    const all = await collectTableChanges(d.conn, 'books', 0, await getMaxSeq(d.conn));
    expect(all).toHaveLength(2);
    const suppressed = await collectTableChanges(
      d.conn,
      'books',
      0,
      await getMaxSeq(d.conn),
      'peer-device',
    );
    expect((suppressed as WireBook[]).map((r) => r.book_id)).toEqual(['b1']);
  });

  it('stampUnstampedRows fills missed stamps and warns', async () => {
    await d.conn.run(`INSERT INTO books (book_id, name, status) VALUES ('raw', 'Unstamped', 1)`);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await stampUnstampedRows(d.conn, d.deviceId);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing syncStamp'));
    warn.mockRestore();
    const rows = await d.conn.query<{ version_hlc: string | null }>(
      `SELECT version_hlc FROM books WHERE book_id = 'raw'`,
    );
    expect(rows[0].version_hlc).not.toBeNull();
  });

  it('chunkRows splits at BATCH_SIZE', () => {
    const rows = Array.from({ length: BATCH_SIZE * 2 + 1 }, (_, i) => i);
    const chunks = chunkRows(rows);
    expect(chunks.map((c) => c.length)).toEqual([BATCH_SIZE, BATCH_SIZE, 1]);
    expect(chunkRows([])).toEqual([]);
  });
});

describe('loopback channel', () => {
  it('delivers frames in order, asynchronously', async () => {
    const [a, b] = createLoopbackPair();
    const received: number[] = [];
    b.onFrame((f) => received.push(f[0]));
    const sends = Promise.all([
      a.send(new Uint8Array([1])),
      a.send(new Uint8Array([2])),
      a.send(new Uint8Array([3])),
    ]);
    expect(received).toEqual([]); // nothing delivered synchronously
    await sends;
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toEqual([1, 2, 3]);
  });

  it('buffers frames until a listener attaches', async () => {
    const [a, b] = createLoopbackPair();
    await a.send(new Uint8Array([7]));
    await new Promise((r) => setTimeout(r, 0));
    const received: number[] = [];
    b.onFrame((f) => received.push(f[0]));
    expect(received).toEqual([7]);
  });

  it('close fires both ends exactly once', async () => {
    const [a, b] = createLoopbackPair();
    let aClosed = 0;
    let bClosed = 0;
    a.onClose(() => (aClosed += 1));
    b.onClose(() => (bClosed += 1));
    await a.close('bye');
    await a.close('again');
    await b.close('echo');
    expect(aClosed).toBe(1);
    expect(bClosed).toBe(1);
  });

  it('failAfterSends drops the connection on the n-th send', async () => {
    const [a, b] = createLoopbackPair();
    a.failAfterSends(2);
    let closed = false;
    b.onClose(() => (closed = true));
    await a.send(new Uint8Array([1]));
    await a.send(new Uint8Array([2]));
    await expect(a.send(new Uint8Array([3]))).rejects.toThrow('injected failure');
    expect(closed).toBe(true);
    await expect(a.send(new Uint8Array([4]))).rejects.toThrow();
  });
});

describe('merge atomicity', () => {
  it('a failing op in finalize leaves the cursor unmoved', async () => {
    const d = await createDevice('atomic');
    await upsertPeer(d.conn, { peer_device_id: 'peer-x', peer_name: 'X', shared_key: 'k' });

    const ctx = getSyncContext();
    const merge = new MergeSession(d.conn, ctx.hlc, d.deviceId, 'peer-x', 0);
    // A book row referencing nothing — applies fine.
    await merge.applyBatch('books', [
      {
        book_id: 'bk',
        name: 'Ok',
        is_closed: 0,
        is_balanced: 0,
        is_auto_open: 0,
        status: 1,
        created_at: '2026-01-01 00:00:00',
        updated_at: null,
        version_hlc: '001750000000000-0000-peerpeer',
        origin_device_id: 'peer-x',
      },
    ]);
    // An entries batch violating the FK (no such ledger) — the batch
    // transaction itself must fail...
    await expect(
      merge.applyBatch('entries', [
        {
          entry_id: 'e-bad',
          ledger_id: 'no-such-ledger',
          book_id: 'bk',
          entry_date: '2026-01-01',
          detail: null,
          amount: 1,
          cat_direction: 'sub',
          transfer_group_id: null,
          status: 1,
          created_at: '2026-01-01 00:00:00',
          updated_at: null,
          version_hlc: '001750000000001-0000-peerpeer',
          origin_device_id: 'peer-x',
        },
      ]),
    ).rejects.toThrow();

    // ...and since finalize never ran, the cursor must still be 0.
    const peer = await getPeer(d.conn, 'peer-x');
    expect(peer!.applied_through_seq).toBe(0);
    // The successfully applied earlier batch is present (per-batch commit)...
    const books = await d.conn.query(`SELECT * FROM books WHERE book_id = 'bk'`);
    expect(books).toHaveLength(1);
    // ...which is safe: re-application after re-pull is an idempotent skip.
    await d.conn.close();
  });
});
