/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import { WebDBConnection, runMigrations, createQueries } from '@ledger/database';
import type { IDBConnection } from '@ledger/database';
import { useBookStore, useLedgerStore, useEntryStore, setDB } from '../src/index.js';

async function createTestDB(): Promise<IDBConnection> {
  const wasmPath = path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: initSqlJs } = (await import('sql.js')) as any;
  const SQL = await initSqlJs({ wasmBinary });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDb: any = new SQL.Database();
  rawDb.run('PRAGMA foreign_keys = ON');
  const conn = new WebDBConnection(rawDb, 'test', false);
  await runMigrations(conn);
  return conn;
}

let conn: IDBConnection;
let bookId: string;
let fromLedgerId: string;
let toLedgerId: string;
let fromEntryId: string;
let toEntryId: string;

const TRANSFER_GROUP = 'tg-test-1';

beforeEach(async () => {
  conn = await createTestDB();
  setDB(conn);
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
    parserPreview: null,
    parserInput: '',
    loading: false,
    error: null,
  });

  const bookResult = await useBookStore.getState().createBook({ name: 'TestBook' });
  bookId = (bookResult as { success: true; data: { book_id: string } }).data.book_id;

  const from = await useLedgerStore
    .getState()
    .createLedger({ book_id: bookId, ledger_name: 'Cash' });
  fromLedgerId = (from as { success: true; data: { ledger_id: string } }).data.ledger_id;

  const to = await useLedgerStore.getState().createLedger({ book_id: bookId, ledger_name: 'Bank' });
  toLedgerId = (to as { success: true; data: { ledger_id: string } }).data.ledger_id;

  // A transfer: 100 out of Cash, 100 into Bank, sharing a transfer_group_id.
  const outEntry = await useEntryStore.getState().addEntry({
    ledger_id: fromLedgerId,
    book_id: bookId,
    entry_date: '2026-01-01',
    detail: 'transfer out',
    amount: 100,
    cat_direction: 'sub',
    transfer_group_id: TRANSFER_GROUP,
  });
  fromEntryId = (outEntry as { success: true; data: { entry_id: string } }).data.entry_id;

  const inEntry = await useEntryStore.getState().addEntry({
    ledger_id: toLedgerId,
    book_id: bookId,
    entry_date: '2026-01-01',
    detail: 'transfer in',
    amount: 100,
    cat_direction: 'add',
    transfer_group_id: TRANSFER_GROUP,
  });
  toEntryId = (inEntry as { success: true; data: { entry_id: string } }).data.entry_id;
});

afterEach(async () => {
  await conn.close();
});

describe('editEntry on a transfer entry', () => {
  it('updates the paired entry amount in the database', async () => {
    const result = await useEntryStore
      .getState()
      .editEntry({ entry_id: fromEntryId, book_id: bookId, updates: { amount: 250 } });
    expect(result.success).toBe(true);

    const q = createQueries(conn);
    const paired = await q.getEntryById(toEntryId);
    expect(paired?.amount).toBe(250);
  });

  it('reflects the paired entry amount in the in-memory store', async () => {
    await useEntryStore
      .getState()
      .editEntry({ entry_id: fromEntryId, book_id: bookId, updates: { amount: 250 } });

    const paired = useEntryStore.getState().entries.find((e) => e.entry_id === toEntryId);
    expect(paired?.amount).toBe(250);
  });

  it('reflects the paired ledger balance in the ledger store', async () => {
    await useEntryStore
      .getState()
      .editEntry({ entry_id: fromEntryId, book_id: bookId, updates: { amount: 250 } });

    // Cash: -250, Bank: +250
    expect(useLedgerStore.getState().getLedger(fromLedgerId)?.balance).toBe(-250);
    expect(useLedgerStore.getState().getLedger(toLedgerId)?.balance).toBe(250);
  });

  it('leaves a non-transfer entry edit untouched elsewhere', async () => {
    const solo = await useEntryStore.getState().addEntry({
      ledger_id: fromLedgerId,
      book_id: bookId,
      entry_date: '2026-01-02',
      detail: 'coffee',
      amount: 5,
      cat_direction: 'sub',
      transfer_group_id: null,
    });
    const soloId = (solo as { success: true; data: { entry_id: string } }).data.entry_id;

    await useEntryStore
      .getState()
      .editEntry({ entry_id: soloId, book_id: bookId, updates: { amount: 7 } });

    const entries = useEntryStore.getState().entries;
    expect(entries.find((e) => e.entry_id === soloId)?.amount).toBe(7);
    expect(entries.find((e) => e.entry_id === toEntryId)?.amount).toBe(100);
  });
});
