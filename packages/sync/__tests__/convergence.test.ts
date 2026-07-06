/**
 * @jest-environment node
 *
 * The crown jewel: N independent devices driven through real store
 * mutations, synced pairwise over loopback channels, asserted byte-equal.
 */
import { useBookStore, useLedgerStore, useEntryStore } from '@ledger/stores';
import type { Book, Ledger } from '@ledger/shared';
import {
  changedRowCount,
  createDevice,
  expectBalancesCorrect,
  expectConverged,
  loadBook,
  pairDevices,
  syncPair,
  transferPreview,
  withDevice,
} from './harness.js';
import type { TestDevice } from './harness.js';

jest.setTimeout(30_000);

async function createBookWithLedgers(
  name: string,
  ledgerNames: string[],
): Promise<{ book: Book; ledgers: Ledger[] }> {
  const bookRes = await useBookStore.getState().createBook({ name });
  expect(bookRes.success).toBe(true);
  const book = bookRes.data!;
  const ledgers: Ledger[] = [];
  for (const ledger_name of ledgerNames) {
    const res = await useLedgerStore
      .getState()
      .createLedger({ book_id: book.book_id, ledger_name, icon: '💰' });
    expect(res.success).toBe(true);
    ledgers.push(res.data!);
  }
  return { book, ledgers };
}

describe('two-device convergence', () => {
  let a: TestDevice;
  let b: TestDevice;

  beforeEach(async () => {
    a = await createDevice('A');
    b = await createDevice('B');
    await pairDevices(a, b);
  });
  afterEach(async () => {
    await a.conn.close();
    await b.conn.close();
  });

  it('1. bootstrap: full snapshot to a fresh peer, then an empty second delta', async () => {
    await withDevice(a, async () => {
      const { book, ledgers } = await createBookWithLedgers('Home', ['Cash', 'Bank']);
      await loadBook(book.book_id);
      await useEntryStore.getState().addEntry({
        book_id: book.book_id,
        ledger_id: ledgers[0].ledger_id,
        entry_date: '2026-07-01',
        amount: 50,
        cat_direction: 'sub',
        detail: 'groceries',
      });
      await useEntryStore
        .getState()
        .submitParsedEntry({
          book_id: book.book_id,
          preview: transferPreview(20, ledgers[0], ledgers[1]),
        });
    });

    const first = await syncPair(b, a); // B pulls the world from A
    expect(first.initiator.pulled).toBeGreaterThan(0);
    await expectConverged([a, b]);
    await expectBalancesCorrect(a);
    await expectBalancesCorrect(b);

    const second = await syncPair(b, a);
    expect(changedRowCount(second.messages.fromInitiator)).toBe(0);
    expect(changedRowCount(second.messages.fromResponder)).toBe(0);
  });

  it('2. concurrent edit of the same entry — higher HLC wins, conflict logged', async () => {
    let bookId = '';
    let entryId = '';
    await withDevice(a, async () => {
      const { book, ledgers } = await createBookWithLedgers('Home', ['Cash']);
      bookId = book.book_id;
      await loadBook(bookId);
      const res = await useEntryStore.getState().addEntry({
        book_id: bookId,
        ledger_id: ledgers[0].ledger_id,
        entry_date: '2026-07-01',
        amount: 10,
        cat_direction: 'sub',
        detail: 'initial',
      });
      entryId = res.data!.entry_id;
    });
    await syncPair(b, a);

    // Offline concurrent edits: A first, B second (B's HLC is later).
    await withDevice(a, async () => {
      await loadBook(bookId);
      await useEntryStore
        .getState()
        .editEntry({ entry_id: entryId, book_id: bookId, updates: { detail: 'from A' } });
    });
    await withDevice(b, async () => {
      await loadBook(bookId);
      await useEntryStore
        .getState()
        .editEntry({ entry_id: entryId, book_id: bookId, updates: { detail: 'from B' } });
    });

    const res = await syncPair(b, a);
    expect(res.initiator.conflicts + res.responder.conflicts).toBeGreaterThan(0);
    await expectConverged([a, b]);

    const winner = await a.conn.query<{ detail: string }>(
      `SELECT detail FROM entries WHERE entry_id = ?`,
      [entryId],
    );
    expect(winner[0].detail).toBe('from B');

    // The concurrency is observed (and logged) on the device that merges it
    // first: B pulls A's losing version, keeps its own, snapshots the loser.
    const conflicts = await b.conn.query<{ kind: string; winner: string; loser_snapshot: string }>(
      `SELECT kind, winner, loser_snapshot FROM sync_conflicts`,
    );
    expect(conflicts.some((c) => c.kind === 'lww' && c.winner === 'local')).toBe(true);
    const snapshot = JSON.parse(
      conflicts.find((c) => c.kind === 'lww' && c.winner === 'local')!.loser_snapshot,
    );
    expect(snapshot.detail).toBe('from A');
  });

  it('3a. delete-vs-later-edit: the edit wins and the entry survives everywhere', async () => {
    let bookId = '';
    let entryId = '';
    await withDevice(a, async () => {
      const { book, ledgers } = await createBookWithLedgers('Home', ['Cash']);
      bookId = book.book_id;
      await loadBook(bookId);
      const res = await useEntryStore.getState().addEntry({
        book_id: bookId,
        ledger_id: ledgers[0].ledger_id,
        entry_date: '2026-07-01',
        amount: 10,
        cat_direction: 'sub',
        detail: 'x',
      });
      entryId = res.data!.entry_id;
    });
    await syncPair(b, a);

    await withDevice(a, async () => {
      await loadBook(bookId);
      await useEntryStore.getState().deleteEntry({ entry_id: entryId, book_id: bookId });
    });
    await withDevice(b, async () => {
      await loadBook(bookId);
      await useEntryStore
        .getState()
        .editEntry({ entry_id: entryId, book_id: bookId, updates: { detail: 'edited later' } });
    });

    await syncPair(b, a);
    await expectConverged([a, b]);
    await expectBalancesCorrect(a);
    await expectBalancesCorrect(b);
    const row = await a.conn.query<{ status: number; detail: string }>(
      `SELECT status, detail FROM entries WHERE entry_id = ?`,
      [entryId],
    );
    expect(row[0]).toEqual({ status: 1, detail: 'edited later' });
  });

  it('3b. edit-vs-later-delete: the tombstone wins everywhere', async () => {
    let bookId = '';
    let entryId = '';
    await withDevice(a, async () => {
      const { book, ledgers } = await createBookWithLedgers('Home', ['Cash']);
      bookId = book.book_id;
      await loadBook(bookId);
      const res = await useEntryStore.getState().addEntry({
        book_id: bookId,
        ledger_id: ledgers[0].ledger_id,
        entry_date: '2026-07-01',
        amount: 10,
        cat_direction: 'sub',
        detail: 'x',
      });
      entryId = res.data!.entry_id;
    });
    await syncPair(b, a);

    await withDevice(a, async () => {
      await loadBook(bookId);
      await useEntryStore
        .getState()
        .editEntry({ entry_id: entryId, book_id: bookId, updates: { detail: 'edited first' } });
    });
    await withDevice(b, async () => {
      await loadBook(bookId);
      await useEntryStore.getState().deleteEntry({ entry_id: entryId, book_id: bookId });
    });

    await syncPair(b, a);
    await expectConverged([a, b]);
    await expectBalancesCorrect(a);
    await expectBalancesCorrect(b);
    const row = await a.conn.query<{ status: number }>(
      `SELECT status FROM entries WHERE entry_id = ?`,
      [entryId],
    );
    expect(row[0].status).toBe(0);
  });

  it('5. books.name UNIQUE collision — loser renamed deterministically everywhere', async () => {
    await withDevice(a, async () => {
      await createBookWithLedgers('Trips', ['Cash']);
    });
    await withDevice(b, async () => {
      await createBookWithLedgers('Trips', ['Wallet']);
    });

    await syncPair(b, a);
    // Renames happened on each side as local edits; a second round propagates them.
    await syncPair(b, a);
    await expectConverged([a, b]);

    const names = await a.conn.query<{ name: string }>(`SELECT name FROM books ORDER BY name`);
    expect(names).toHaveLength(2);
    const plain = names.filter((n) => n.name === 'Trips');
    const suffixed = names.filter((n) => /^Trips \([0-9a-f]{4}\)$/.test(n.name));
    expect(plain).toHaveLength(1);
    expect(suffixed).toHaveLength(1);

    const conflicts = await a.conn.query<{ kind: string }>(
      `SELECT kind FROM sync_conflicts WHERE kind = 'unique_name'`,
    );
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('6. ledger alias UNIQUE collision — loser alias goes NULL everywhere', async () => {
    let bookId = '';
    await withDevice(a, async () => {
      const { book, ledgers } = await createBookWithLedgers('Home', ['Cash']);
      bookId = book.book_id;
      await loadBook(bookId);
      await useLedgerStore
        .getState()
        .setLedgerAlias({ ledger_id: ledgers[0].ledger_id, alias: 'main', book_id: bookId });
    });
    await syncPair(b, a);

    // B creates a second ledger in the same book and claims the same alias
    // while A is offline; A also re-aliases its ledger — no wait, keep it
    // simple: B aliases a NEW ledger to 'main' after A already owns it? That
    // would violate B's local UNIQUE. Instead: both devices alias DIFFERENT
    // ledgers to the same value while offline.
    let aLedger = '';
    let bLedger = '';
    await withDevice(a, async () => {
      await loadBook(bookId);
      const res = await useLedgerStore
        .getState()
        .createLedger({ book_id: bookId, ledger_name: 'Bank', icon: '🏦' });
      aLedger = res.data!.ledger_id;
      await useLedgerStore
        .getState()
        .setLedgerAlias({ ledger_id: aLedger, alias: 'shared', book_id: bookId });
    });
    await withDevice(b, async () => {
      await loadBook(bookId);
      const res = await useLedgerStore
        .getState()
        .createLedger({ book_id: bookId, ledger_name: 'Savings', icon: '🐷' });
      bLedger = res.data!.ledger_id;
      await useLedgerStore
        .getState()
        .setLedgerAlias({ ledger_id: bLedger, alias: 'shared', book_id: bookId });
    });

    await syncPair(b, a);
    await syncPair(b, a); // propagate the local-loser NULL-out
    await expectConverged([a, b]);

    const holders = await a.conn.query<{ ledger_id: string }>(
      `SELECT ledger_id FROM ledgers WHERE alias = 'shared'`,
    );
    expect(holders).toHaveLength(1);
    const conflicts = await a.conn.query<{ kind: string }>(
      `SELECT kind FROM sync_conflicts WHERE kind = 'unique_alias'`,
    );
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('9. clock skew: a 1-hour-slow device still wins with a post-receive edit', async () => {
    const slow = await createDevice('SLOW', { clockOffsetMs: -3_600_000 });
    await pairDevices(a, slow);

    let bookId = '';
    let entryId = '';
    await withDevice(a, async () => {
      const { book, ledgers } = await createBookWithLedgers('Skew', ['Cash']);
      bookId = book.book_id;
      await loadBook(bookId);
      const res = await useEntryStore.getState().addEntry({
        book_id: bookId,
        ledger_id: ledgers[0].ledger_id,
        entry_date: '2026-07-01',
        amount: 10,
        cat_direction: 'sub',
        detail: 'from fast clock',
      });
      entryId = res.data!.entry_id;
    });

    await syncPair(slow, a); // slow device RECEIVES the edit → hlc.receive() advances it
    await withDevice(slow, async () => {
      await loadBook(bookId);
      await useEntryStore
        .getState()
        .editEntry({ entry_id: entryId, book_id: bookId, updates: { detail: 'slow but saw it' } });
    });

    await syncPair(slow, a);
    await expectConverged([a, slow]);
    const row = await a.conn.query<{ detail: string }>(
      `SELECT detail FROM entries WHERE entry_id = ?`,
      [entryId],
    );
    expect(row[0].detail).toBe('slow but saw it');
    await slow.conn.close();
  });

  it('10. cursor-0 re-pair: full re-delivery is idempotent, no new conflicts', async () => {
    await withDevice(a, async () => {
      const { book, ledgers } = await createBookWithLedgers('Home', ['Cash', 'Bank']);
      await loadBook(book.book_id);
      await useEntryStore.getState().addEntry({
        book_id: book.book_id,
        ledger_id: ledgers[0].ledger_id,
        entry_date: '2026-07-01',
        amount: 42,
        cat_direction: 'add',
        detail: 'x',
      });
    });
    await syncPair(b, a);
    await expectConverged([a, b]);

    const before = await a.conn.query(`SELECT * FROM books ORDER BY book_id`);
    const conflictsBefore = await b.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sync_conflicts`,
    );

    // Simulate re-pair: B forgets how far it has applied A's log.
    await b.conn.run(`UPDATE sync_peers SET applied_through_seq = 0 WHERE peer_device_id = ?`, [
      a.deviceId,
    ]);
    const res = await syncPair(b, a);
    expect(changedRowCount(res.messages.fromResponder)).toBeGreaterThan(0); // full re-send
    await expectConverged([a, b]);

    const after = await a.conn.query(`SELECT * FROM books ORDER BY book_id`);
    expect(after).toEqual(before);
    const conflictsAfter = await b.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sync_conflicts`,
    );
    expect(conflictsAfter[0].n).toBe(conflictsBefore[0].n);
  });

  it('11. echo suppression: rows originating on the receiver are not sent back', async () => {
    let bookId = '';
    await withDevice(a, async () => {
      const { book } = await createBookWithLedgers('Home', ['Cash']);
      bookId = book.book_id;
    });
    await syncPair(b, a);

    // B makes a change; sync B→A; then in the NEXT session A must not echo
    // B's own row back to B.
    await withDevice(b, async () => {
      await loadBook(bookId);
      await useBookStore.getState().renameBook({ book_id: bookId, name: 'Renamed by B' });
    });
    await syncPair(b, a);
    const third = await syncPair(b, a);
    expect(changedRowCount(third.messages.fromResponder)).toBe(0);
    await expectConverged([a, b]);
  });

  it('12. deleteBook cascade tombstones propagate fully', async () => {
    let bookId = '';
    await withDevice(a, async () => {
      const { book, ledgers } = await createBookWithLedgers('Doomed', ['Cash', 'Bank']);
      bookId = book.book_id;
      await loadBook(bookId);
      await useEntryStore.getState().addEntry({
        book_id: bookId,
        ledger_id: ledgers[0].ledger_id,
        entry_date: '2026-07-01',
        amount: 5,
        cat_direction: 'sub',
        detail: 'x',
      });
    });
    await syncPair(b, a);

    await withDevice(a, async () => {
      await useBookStore.getState().deleteBook(bookId);
    });
    await syncPair(b, a);
    await expectConverged([a, b]);

    const counts = await b.conn.query<{ books: number; ledgers: number; entries: number }>(
      `SELECT (SELECT COUNT(*) FROM books WHERE status = 1) AS books,
              (SELECT COUNT(*) FROM ledgers WHERE status = 1) AS ledgers,
              (SELECT COUNT(*) FROM entries WHERE status = 1) AS entries`,
    );
    expect(counts[0]).toEqual({ books: 0, ledgers: 0, entries: 0 });
  });
});

describe('transfer repair (scenario 4)', () => {
  it('divergent pair members are repaired from the higher-HLC member and propagate to a third device', async () => {
    const a = await createDevice('A');
    const b = await createDevice('B');
    const c = await createDevice('C');
    await pairDevices(a, b);
    await pairDevices(b, c);
    await pairDevices(a, c);

    let bookId = '';
    let entryIds: string[] = [];
    await withDevice(a, async () => {
      const { book, ledgers } = await createBookWithLedgers('Home', ['Src', 'Dst']);
      bookId = book.book_id;
      await loadBook(bookId);
      const res = await useEntryStore
        .getState()
        .submitParsedEntry({ book_id: bookId, preview: transferPreview(100, ledgers[0], ledgers[1]) });
      expect(res.success).toBe(true);
      entryIds = res.data!.map((e) => e.entry_id);
    });
    await syncPair(b, a);

    // Force pair divergence with raw single-member edits (not achievable via
    // the store, which always updates both members — exactly the corruption
    // the repair pass exists for). A edits member 0 later than B edits member 1.
    await b.conn.run(
      `UPDATE entries SET amount = 250, version_hlc = ?, origin_device_id = ? WHERE entry_id = ?`,
      [b.ctx.hlc.now(), b.deviceId, entryIds[1]],
    );
    // A real editor maintains its own ledger balance; mirror that (Dst, add 250).
    await b.conn.run(`UPDATE ledgers SET balance = 250 WHERE ledger_id = (SELECT ledger_id FROM entries WHERE entry_id = ?)`, [entryIds[1]]);
    await new Promise((r) => setTimeout(r, 5)); // ensure A's stamp is strictly later
    await a.conn.run(
      `UPDATE entries SET amount = 300, version_hlc = ?, origin_device_id = ? WHERE entry_id = ?`,
      [a.ctx.hlc.now(), a.deviceId, entryIds[0]],
    );
    await a.conn.run(`UPDATE ledgers SET balance = -300 WHERE ledger_id = (SELECT ledger_id FROM entries WHERE entry_id = ?)`, [entryIds[0]]);

    await syncPair(b, a);
    // Repair happened on the puller; second round propagates repaired rows.
    await syncPair(b, a);
    await expectConverged([a, b]);

    const amounts = await a.conn.query<{ amount: number }>(
      `SELECT amount FROM entries WHERE entry_id IN (?, ?) ORDER BY entry_id`,
      entryIds,
    );
    expect(amounts.map((r) => r.amount)).toEqual([300, 300]); // A's later edit won
    await expectBalancesCorrect(a);
    await expectBalancesCorrect(b);

    const repairs = await a.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sync_conflicts WHERE kind = 'transfer_repair'`,
    );
    const repairsB = await b.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sync_conflicts WHERE kind = 'transfer_repair'`,
    );
    expect(repairs[0].n + repairsB[0].n).toBeGreaterThan(0);

    // Third device gets the repaired state as ordinary edits.
    await syncPair(c, a);
    await expectConverged([a, b, c]);
    await expectBalancesCorrect(c);

    await a.conn.close();
    await b.conn.close();
    await c.conn.close();
  });
});

describe('three-device transitivity (scenario 7)', () => {
  it('A→B→C→A ring converges and the closing session is an empty delta', async () => {
    const a = await createDevice('A');
    const b = await createDevice('B');
    const c = await createDevice('C');
    await pairDevices(a, b);
    await pairDevices(b, c);
    await pairDevices(c, a);

    await withDevice(a, async () => {
      const { book, ledgers } = await createBookWithLedgers('A-Book', ['Cash']);
      await loadBook(book.book_id);
      await useEntryStore.getState().addEntry({
        book_id: book.book_id,
        ledger_id: ledgers[0].ledger_id,
        entry_date: '2026-07-01',
        amount: 1,
        cat_direction: 'add',
        detail: 'from A',
      });
    });
    await withDevice(b, async () => {
      await createBookWithLedgers('B-Book', ['Wallet']);
    });
    await withDevice(c, async () => {
      await createBookWithLedgers('C-Book', ['Purse']);
    });

    await syncPair(a, b); // A↔B
    await syncPair(b, c); // B↔C  (C receives A's data via B — transitivity)
    await syncPair(c, a); // C↔A closes the ring

    await expectConverged([a, b, c]);
    await expectBalancesCorrect(a);
    await expectBalancesCorrect(b);
    await expectBalancesCorrect(c);

    // Everyone is identical. The next A↔B round may still SEND rows learned
    // from C (echo suppression only covers the receiver's own rows), but they
    // must all be skipped — nothing applied, no conflicts.
    const final = await syncPair(a, b);
    expect(final.initiator.pulled).toBe(0);
    expect(final.responder.pulled).toBe(0);
    expect(final.initiator.conflicts).toBe(0);
    expect(final.responder.conflicts).toBe(0);

    // Skips write nothing, so nothing re-registers: the round after IS empty.
    const after = await syncPair(a, b);
    expect(changedRowCount(after.messages.fromInitiator)).toBe(0);
    expect(changedRowCount(after.messages.fromResponder)).toBe(0);

    await a.conn.close();
    await b.conn.close();
    await c.conn.close();
  });
});
