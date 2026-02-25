/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import { WebDBConnection, runMigrations, createQueries } from '../src/index.js';
import type { IDBConnection } from '../src/index.js';
import type { Queries } from '../src/index.js';

async function createTestDB(): Promise<IDBConnection> {
  // Load WASM binary directly to bypass jsdom browser-mode detection in sql.js
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
let q: Queries;

beforeEach(async () => {
  conn = await createTestDB();
  q = createQueries(conn);
});

afterEach(async () => {
  await conn.close();
});

// ── Books ───────────────────────────────────────────────────────────────────

describe('Books queries', () => {
  it('getBooks returns empty initially', async () => {
    const books = await q.getBooks();
    expect(books).toEqual([]);
  });

  it('insertBook then getBooks returns the book', async () => {
    await q.insertBook('book-1', 'My Book');
    const books = await q.getBooks();
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ book_id: 'book-1', name: 'My Book', is_closed: 0 });
  });

  it('getBookById returns the book by id', async () => {
    await q.insertBook('book-2', 'Second Book');
    const book = await q.getBookById('book-2');
    expect(book).not.toBeNull();
    expect(book!.name).toBe('Second Book');
  });

  it('getBookById returns null for missing id', async () => {
    const book = await q.getBookById('nonexistent');
    expect(book).toBeNull();
  });

  it('updateBookName updates the name', async () => {
    await q.insertBook('book-3', 'Old Name');
    await q.updateBookName('book-3', 'New Name');
    const book = await q.getBookById('book-3');
    expect(book!.name).toBe('New Name');
  });

  it('setBookClosed sets is_closed to 1', async () => {
    await q.insertBook('book-4', 'Closeable');
    await q.setBookClosed('book-4', 1);
    const book = await q.getBookById('book-4');
    expect(book!.is_closed).toBe(1);
  });

  it('softDeleteBook removes book from active list', async () => {
    await q.insertBook('book-5', 'To Delete');
    await q.softDeleteBook('book-5');
    const book = await q.getBookById('book-5');
    expect(book).toBeNull();
    const books = await q.getBooks();
    expect(books.find((b) => b.book_id === 'book-5')).toBeUndefined();
  });

  it('getBooksWithLedgerCount includes ledger_count', async () => {
    await q.insertBook('book-6', 'With Ledgers');
    await q.insertLedger('led-1', 'book-6', 'Cash', '💰');
    const books = await q.getBooksWithLedgerCount();
    const found = books.find((b) => b.book_id === 'book-6');
    expect(found).toBeDefined();
    expect(found!.ledger_count).toBe(1);
  });
});

// ── Ledgers ─────────────────────────────────────────────────────────────────

describe('Ledgers queries', () => {
  beforeEach(async () => {
    await q.insertBook('book-led', 'Ledger Test Book');
  });

  it('getLedgers returns empty initially', async () => {
    const ledgers = await q.getLedgers('book-led');
    expect(ledgers).toEqual([]);
  });

  it('insertLedger then getLedgers returns the ledger', async () => {
    await q.insertLedger('led-a', 'book-led', 'Savings', '🏦');
    const ledgers = await q.getLedgers('book-led');
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]).toMatchObject({ ledger_id: 'led-a', ledger_name: 'Savings', icon: '🏦' });
  });

  it('getLedgerByAlias returns null when no alias set', async () => {
    await q.insertLedger('led-b', 'book-led', 'Cash', '💵');
    const result = await q.getLedgerByAlias('book-led', 'cash');
    expect(result).toBeNull();
  });

  it('updateLedgerAlias then getLedgerByAlias finds it', async () => {
    await q.insertLedger('led-c', 'book-led', 'Wallet', '👛');
    await q.updateLedgerAlias('led-c', 'wallet');
    const result = await q.getLedgerByAlias('book-led', 'wallet');
    expect(result).not.toBeNull();
    expect(result!.ledger_id).toBe('led-c');
  });

  it('updateLedgerBalance updates the balance', async () => {
    await q.insertLedger('led-d', 'book-led', 'Checking', '💳');
    await q.updateLedgerBalance('led-d', 500.50);
    const ledger = await q.getLedgerById('led-d');
    expect(ledger!.balance).toBe(500.50);
  });

  it('softDeleteLedger removes ledger from list', async () => {
    await q.insertLedger('led-e', 'book-led', 'ToDelete', '🗑️');
    await q.softDeleteLedger('led-e');
    const ledgers = await q.getLedgers('book-led');
    expect(ledgers.find((l) => l.ledger_id === 'led-e')).toBeUndefined();
  });
});

// ── Entries ─────────────────────────────────────────────────────────────────

describe('Entries queries', () => {
  beforeEach(async () => {
    await q.insertBook('book-ent', 'Entry Test Book');
    await q.insertLedger('led-ent', 'book-ent', 'Main Ledger', '📊');
  });

  it('getEntriesByLedger returns empty initially', async () => {
    const entries = await q.getEntriesByLedger('led-ent');
    expect(entries).toEqual([]);
  });

  it('insertEntry then getEntriesByLedger returns the entry', async () => {
    await q.insertEntry('ent-1', {
      ledger_id: 'led-ent',
      book_id: 'book-ent',
      entry_date: '2024-01-15',
      detail: 'Grocery shopping',
      amount: 45.50,
      cat_direction: 'sub',
      transfer_group_id: null,
    });
    const entries = await q.getEntriesByLedger('led-ent');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entry_id: 'ent-1',
      amount: 45.50,
      cat_direction: 'sub',
      detail: 'Grocery shopping',
    });
  });

  it('getTransferGroup returns both entries in a transfer', async () => {
    await q.insertLedger('led-ent2', 'book-ent', 'Secondary', '💰');
    const groupId = 'transfer-group-1';
    await q.insertEntry('ent-t1', {
      ledger_id: 'led-ent',
      book_id: 'book-ent',
      entry_date: '2024-01-20',
      detail: 'Transfer out',
      amount: 100,
      cat_direction: 'sub',
      transfer_group_id: groupId,
    });
    await q.insertEntry('ent-t2', {
      ledger_id: 'led-ent2',
      book_id: 'book-ent',
      entry_date: '2024-01-20',
      detail: 'Transfer in',
      amount: 100,
      cat_direction: 'add',
      transfer_group_id: groupId,
    });
    const group = await q.getTransferGroup(groupId);
    expect(group).toHaveLength(2);
    expect(group.map((e) => e.entry_id).sort()).toEqual(['ent-t1', 'ent-t2']);
  });

  it('updateEntryFields updates fields', async () => {
    await q.insertEntry('ent-2', {
      ledger_id: 'led-ent',
      book_id: 'book-ent',
      entry_date: '2024-02-01',
      detail: 'Old detail',
      amount: 10,
      cat_direction: 'add',
      transfer_group_id: null,
    });
    await q.updateEntryFields('ent-2', { detail: 'New detail', amount: 20 });
    const entry = await q.getEntryById('ent-2');
    expect(entry!.detail).toBe('New detail');
    expect(entry!.amount).toBe(20);
  });

  it('softDeleteEntry removes entry from list', async () => {
    await q.insertEntry('ent-3', {
      ledger_id: 'led-ent',
      book_id: 'book-ent',
      entry_date: '2024-03-01',
      detail: null,
      amount: 5,
      cat_direction: 'sub',
      transfer_group_id: null,
    });
    await q.softDeleteEntry('ent-3');
    const entries = await q.getEntriesByLedger('led-ent');
    expect(entries.find((e) => e.entry_id === 'ent-3')).toBeUndefined();
  });
});

// ── Settings ─────────────────────────────────────────────────────────────────

describe('Settings queries', () => {
  it('getSettings returns null when no settings exist', async () => {
    const settings = await q.getSettings();
    expect(settings).toBeNull();
  });

  it('insertSettings then getSettings returns the settings', async () => {
    await q.insertSettings('settings-1');
    const settings = await q.getSettings();
    expect(settings).not.toBeNull();
    expect(settings!.dark_mode).toBe(0);
    expect(settings!.cat_default_entry_direction).toBe('sub');
  });

  it('updateSettingsDarkMode updates dark_mode', async () => {
    await q.insertSettings('settings-2');
    await q.updateSettingsDarkMode(1);
    const settings = await q.getSettings();
    expect(settings!.dark_mode).toBe(1);
  });

  it('updateSettingsWeekStart updates week_start_day', async () => {
    await q.insertSettings('settings-3');
    await q.updateSettingsWeekStart(1);
    const settings = await q.getSettings();
    expect(settings!.week_start_day).toBe(1);
  });
});
