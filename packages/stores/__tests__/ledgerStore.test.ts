/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import { WebDBConnection, runMigrations } from '@ledger/database';
import type { IDBConnection } from '@ledger/database';
import { useBookStore, useLedgerStore, setDB } from '../src/index.js';

async function createTestDB(): Promise<IDBConnection> {
  const wasmPath = path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: initSqlJs } = await import('sql.js') as any;
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
let ledgerId: string;

beforeEach(async () => {
  conn = await createTestDB();
  setDB(conn);
  useBookStore.setState({ books: [], currentBook: null, loading: false, error: null });
  useLedgerStore.setState({ ledgers: [], currentBook_id: null, collapsed: {}, loading: false, error: null });

  // Create a book and ledger for tests
  const bookResult = await useBookStore.getState().createBook({ name: 'TestBook' });
  expect(bookResult.success).toBe(true);
  bookId = (bookResult as { success: true; data: { book_id: string } }).data.book_id;

  const ledgerResult = await useLedgerStore.getState().createLedger({
    book_id: bookId,
    ledger_name: 'Groceries',
  });
  expect(ledgerResult.success).toBe(true);
  ledgerId = (ledgerResult as { success: true; data: { ledger_id: string } }).data.ledger_id;
});

afterEach(async () => {
  await conn.close();
});

describe('setLedgerAlias', () => {
  it('sets alias on ledger and updates state', async () => {
    const result = await useLedgerStore.getState().setLedgerAlias({
      ledger_id: ledgerId,
      alias: 'groc',
      book_id: bookId,
    });
    expect(result.success).toBe(true);
    const ledger = useLedgerStore.getState().getLedger(ledgerId);
    expect(ledger?.alias).toBe('groc');
  });

  it('alias is stored in lowercase', async () => {
    await useLedgerStore.getState().setLedgerAlias({
      ledger_id: ledgerId,
      alias: 'GROC',
      book_id: bookId,
    });
    const ledger = useLedgerStore.getState().getLedger(ledgerId);
    expect(ledger?.alias).toBe('groc');
  });

  it('can look up ledger by alias after setting it', async () => {
    await useLedgerStore.getState().setLedgerAlias({
      ledger_id: ledgerId,
      alias: 'groc',
      book_id: bookId,
    });
    const found = useLedgerStore.getState().getLedgerByAlias(bookId, 'groc');
    expect(found?.ledger_id).toBe(ledgerId);
  });

  it('returns VALIDATION_ERROR when alias already in use', async () => {
    // Create a second ledger
    const second = await useLedgerStore.getState().createLedger({
      book_id: bookId,
      ledger_name: 'Entertainment',
    });
    const secondId = (second as { success: true; data: { ledger_id: string } }).data.ledger_id;

    await useLedgerStore.getState().setLedgerAlias({
      ledger_id: ledgerId,
      alias: 'groc',
      book_id: bookId,
    });

    const result = await useLedgerStore.getState().setLedgerAlias({
      ledger_id: secondId,
      alias: 'groc',
      book_id: bookId,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  it('can update own alias without conflict', async () => {
    await useLedgerStore.getState().setLedgerAlias({
      ledger_id: ledgerId,
      alias: 'groc',
      book_id: bookId,
    });
    // Setting same alias on same ledger should succeed
    const result = await useLedgerStore.getState().setLedgerAlias({
      ledger_id: ledgerId,
      alias: 'groc',
      book_id: bookId,
    });
    expect(result.success).toBe(true);
  });

  it('clears alias when null is passed', async () => {
    await useLedgerStore.getState().setLedgerAlias({
      ledger_id: ledgerId,
      alias: 'groc',
      book_id: bookId,
    });
    await useLedgerStore.getState().setLedgerAlias({
      ledger_id: ledgerId,
      alias: null,
      book_id: bookId,
    });
    const ledger = useLedgerStore.getState().getLedger(ledgerId);
    expect(ledger?.alias).toBeNull();
  });

  it('returns NOT_FOUND for nonexistent ledger', async () => {
    const result = await useLedgerStore.getState().setLedgerAlias({
      ledger_id: 'does-not-exist',
      alias: 'test',
      book_id: bookId,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('returns PERMISSION_DENIED for closed book', async () => {
    await useBookStore.getState().closeBook(bookId);
    // Re-sync book state in store
    await useBookStore.getState().fetchBooks();

    const result = await useLedgerStore.getState().setLedgerAlias({
      ledger_id: ledgerId,
      alias: 'groc',
      book_id: bookId,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('PERMISSION_DENIED');
    }
  });
});
