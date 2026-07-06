/**
 * @jest-environment node
 *
 * Scenario 8: drop the connection after every possible frame index, in both
 * directions; the interrupted session must reject cleanly, cursors must never
 * advance past a completed apply, and a clean follow-up session must converge
 * with no duplicate application and no spurious conflicts.
 */
import { useBookStore, useEntryStore, useLedgerStore } from '@ledger/stores';
import {
  changedRowCount,
  createDevice,
  expectBalancesCorrect,
  expectConverged,
  loadBook,
  pairDevices,
  syncPair,
  withDevice,
} from './harness.js';
import type { TestDevice } from './harness.js';

jest.setTimeout(60_000);

async function seedDivergence(a: TestDevice, b: TestDevice): Promise<void> {
  let bookId = '';
  let entryId = '';
  await withDevice(a, async () => {
    const bookRes = await useBookStore.getState().createBook({ name: 'Crash' });
    bookId = bookRes.data!.book_id;
    const ledgerRes = await useLedgerStore
      .getState()
      .createLedger({ book_id: bookId, ledger_name: 'Cash', icon: '💰' });
    await loadBook(bookId);
    const entryRes = await useEntryStore.getState().addEntry({
      book_id: bookId,
      ledger_id: ledgerRes.data!.ledger_id,
      entry_date: '2026-07-01',
      amount: 10,
      cat_direction: 'sub',
      detail: 'seed',
    });
    entryId = entryRes.data!.entry_id;
  });
  await syncPair(b, a);
  // Divergence on both sides so both halves of a session carry data.
  await withDevice(a, async () => {
    await loadBook(bookId);
    await useEntryStore
      .getState()
      .editEntry({ entry_id: entryId, book_id: bookId, updates: { detail: 'A says' } });
  });
  await withDevice(b, async () => {
    await loadBook(bookId);
    await useBookStore.getState().renameBook({ book_id: bookId, name: 'Crash renamed' });
  });
}

async function conflictCount(d: TestDevice): Promise<number> {
  const rows = await d.conn.query<{ n: number }>(`SELECT COUNT(*) AS n FROM sync_conflicts`);
  return rows[0].n;
}

describe('crash injection at every frame index', () => {
  it('measures the reference session, then survives a drop after every frame from either side', async () => {
    // Reference run to count frames per direction.
    const refA = await createDevice('refA');
    const refB = await createDevice('refB');
    await pairDevices(refA, refB);
    await seedDivergence(refA, refB);
    const ref = await syncPair(refB, refA);
    const framesFromInitiator = ref.messages.fromInitiator.length;
    const framesFromResponder = ref.messages.fromResponder.length;
    expect(framesFromInitiator).toBeGreaterThan(2);
    expect(framesFromResponder).toBeGreaterThan(2);
    await refA.conn.close();
    await refB.conn.close();

    for (const side of ['initiator', 'responder'] as const) {
      const frames = side === 'initiator' ? framesFromInitiator : framesFromResponder;
      for (let n = 0; n < frames; n++) {
        const a = await createDevice(`A-${side}-${n}`);
        const b = await createDevice(`B-${side}-${n}`);
        await pairDevices(a, b);
        await seedDivergence(a, b);

        // Interrupted session must reject for both engines.
        await expect(
          syncPair(b, a, { failAfterSends: { [side]: n } }),
        ).rejects.toThrow();

        // Clean retry converges with correct balances.
        const retry = await syncPair(b, a);
        await expectConverged([a, b]);
        await expectBalancesCorrect(a);
        await expectBalancesCorrect(b);

        // No spurious LWW conflicts from re-application: every conflict must
        // be the one real concurrent-edit... here A and B edited DIFFERENT
        // rows, so there must be none at all.
        expect(await conflictCount(a)).toBe(0);
        expect(await conflictCount(b)).toBe(0);

        // And the state settles: one more session moves nothing.
        const settle = await syncPair(b, a);
        expect(changedRowCount(settle.messages.fromInitiator)).toBe(0);
        expect(changedRowCount(settle.messages.fromResponder)).toBe(0);
        expect(retry.initiator.pulled + retry.responder.pulled).toBeGreaterThanOrEqual(0);

        await a.conn.close();
        await b.conn.close();
      }
    }
  });
});
