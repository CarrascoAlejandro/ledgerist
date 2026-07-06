/**
 * @jest-environment node
 *
 * Perf harness (phase 6e) — run with:  SYNC_PERF=1 npx jest --selectProjects sync --testPathPattern perf
 * Seeds ~50k entries across 200 ledgers / 10 books, then measures a cursor-0
 * full session over a loopback channel (the ws+crypto path is covered by the
 * integration suite; loopback isolates engine/merge throughput).
 */
import { setSyncContext } from '@ledger/shared';
import { buildOps, createQueries } from '@ledger/database';
import type { DBOperation } from '@ledger/database';
import { createDevice, expectBalancesCorrect, expectConverged, pairDevices, syncPair } from './harness.js';

const maybeDescribe = process.env.SYNC_PERF ? describe : describe.skip;

jest.setTimeout(600_000);

const BOOKS = 10;
const LEDGERS_PER_BOOK = 20;
const ENTRIES = 50_000;

maybeDescribe('50k-entry full sync perf', () => {
  it('seeds, syncs at cursor 0, and reports timings', async () => {
    const a = await createDevice('perfA');
    const b = await createDevice('perfB');
    await pairDevices(a, b);
    setSyncContext(a.ctx); // seed writes must stamp with A's identity
    const q = createQueries(a.conn);

    const seedStart = Date.now();
    const ledgerIds: Array<{ ledger_id: string; book_id: string }> = [];
    for (let bi = 0; bi < BOOKS; bi++) {
      const bookId = `book-${bi}`;
      await q.insertBook(bookId, `Book ${bi}`);
      for (let li = 0; li < LEDGERS_PER_BOOK; li++) {
        const ledgerId = `ledger-${bi}-${li}`;
        await q.insertLedger(ledgerId, bookId, `Ledger ${li}`, '💰');
        ledgerIds.push({ ledger_id: ledgerId, book_id: bookId });
      }
    }
    // Batch entry inserts in transactions of 1000 for seed speed.
    let ops: DBOperation[] = [];
    for (let i = 0; i < ENTRIES; i++) {
      const target = ledgerIds[i % ledgerIds.length];
      ops.push(
        buildOps.insertEntry(`entry-${i}`, {
          ledger_id: target.ledger_id,
          book_id: target.book_id,
          entry_date: `2026-0${(i % 9) + 1}-1${i % 9}`,
          detail: `seeded entry ${i}`,
          amount: (i % 500) + 1,
          cat_direction: i % 3 === 0 ? 'add' : 'sub',
          transfer_group_id: null,
        }),
      );
      if (ops.length === 1000) {
        await a.conn.transaction(ops);
        ops = [];
      }
    }
    if (ops.length > 0) await a.conn.transaction(ops);
    // Fix balances once (seed bypassed the store's balance maintenance).
    for (const { ledger_id } of ledgerIds) {
      await a.conn.run(
        `UPDATE ledgers SET balance = (
           SELECT COALESCE(SUM(CASE cat_direction WHEN 'add' THEN amount ELSE -amount END), 0)
           FROM entries WHERE ledger_id = ? AND status = 1) WHERE ledger_id = ?`,
        [ledger_id, ledger_id],
      );
    }
    // eslint-disable-next-line no-console
    console.info(`[perf] seeded ${ENTRIES} entries in ${Date.now() - seedStart} ms`);

    const syncStart = Date.now();
    const result = await syncPair(b, a);
    const elapsed = Date.now() - syncStart;
    // eslint-disable-next-line no-console
    console.info(
      `[perf] cursor-0 session: pulled ${result.initiator.pulled} rows in ${elapsed} ms (${Math.round(
        (result.initiator.pulled / elapsed) * 1000,
      )} rows/s)`,
    );

    expect(result.initiator.pulled).toBe(ENTRIES + BOOKS + BOOKS * LEDGERS_PER_BOOK);
    await expectConverged([a, b]);
    await expectBalancesCorrect(b);

    const secondStart = Date.now();
    const second = await syncPair(b, a);
    // eslint-disable-next-line no-console
    console.info(`[perf] steady-state empty session: ${Date.now() - secondStart} ms`);
    expect(second.initiator.pulled).toBe(0);

    await a.conn.close();
    await b.conn.close();
  });
});
