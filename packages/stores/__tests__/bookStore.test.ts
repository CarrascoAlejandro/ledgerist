/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import { WebDBConnection, runMigrations } from '@ledger/database';
import type { IDBConnection } from '@ledger/database';
import { useBookStore, useLedgerStore, setDB } from '../src/index.js';

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

beforeEach(async () => {
  conn = await createTestDB();
  setDB(conn);
  // Reset store state
  useBookStore.setState({ books: [], currentBook: null, loading: false, error: null });
  useLedgerStore.setState({ ledgers: [], currentBook_id: null, collapsed: {}, loading: false, error: null });
});

afterEach(async () => {
  await conn.close();
});

describe('createBook', () => {
  it('valid name returns success with book data', async () => {
    const result = await useBookStore.getState().createBook({ name: 'My Ledger' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ name: 'My Ledger', is_closed: 0 });
    }
  });

  it('empty name returns VALIDATION_ERROR', async () => {
    const result = await useBookStore.getState().createBook({ name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  it('whitespace-only name returns VALIDATION_ERROR', async () => {
    const result = await useBookStore.getState().createBook({ name: '   ' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  it('duplicate name returns CONFLICT', async () => {
    await useBookStore.getState().createBook({ name: 'DupBook' });
    const result = await useBookStore.getState().createBook({ name: 'DupBook' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('CONFLICT');
    }
  });

  it('duplicate name is case-insensitive', async () => {
    await useBookStore.getState().createBook({ name: 'MyBook' });
    const result = await useBookStore.getState().createBook({ name: 'mybook' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('CONFLICT');
    }
  });
});

describe('fetchBooks', () => {
  it('returns books from DB including ledger_count', async () => {
    await useBookStore.getState().createBook({ name: 'FetchTest' });
    // Reset store to simulate fresh load
    useBookStore.setState({ books: [], currentBook: null });
    await useBookStore.getState().fetchBooks();
    const { books } = useBookStore.getState();
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ name: 'FetchTest' });
    // ledger_count is included at runtime (added by getBooksWithLedgerCount)
    expect((books[0] as { ledger_count: number }).ledger_count).toBe(0);
  });
});

describe('openBook', () => {
  it('sets currentBook on success', async () => {
    const create = await useBookStore.getState().createBook({ name: 'OpenMe' });
    expect(create.success).toBe(true);
    const bookId = (create as { success: true; data: { book_id: string } }).data.book_id;

    const result = await useBookStore.getState().openBook(bookId);
    expect(result.success).toBe(true);
    expect(useBookStore.getState().currentBook?.book_id).toBe(bookId);
  });

  it('non-existent id returns NOT_FOUND', async () => {
    const result = await useBookStore.getState().openBook('nonexistent-id');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });
});

describe('renameBook', () => {
  it('updates name in state and DB', async () => {
    const create = await useBookStore.getState().createBook({ name: 'OldName' });
    const book_id = (create as { success: true; data: { book_id: string } }).data.book_id;

    const result = await useBookStore.getState().renameBook({ book_id, name: 'NewName' });
    expect(result.success).toBe(true);
    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    expect(book?.name).toBe('NewName');
  });
});

describe('closeBook / reopenBook', () => {
  it('closeBook sets is_closed to 1', async () => {
    const create = await useBookStore.getState().createBook({ name: 'ToClose' });
    const book_id = (create as { success: true; data: { book_id: string } }).data.book_id;

    const result = await useBookStore.getState().closeBook(book_id);
    expect(result.success).toBe(true);
    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    expect(book?.is_closed).toBe(1);
  });

  it('reopenBook sets is_closed to 0', async () => {
    const create = await useBookStore.getState().createBook({ name: 'ToReopen' });
    const book_id = (create as { success: true; data: { book_id: string } }).data.book_id;

    await useBookStore.getState().closeBook(book_id);
    const result = await useBookStore.getState().reopenBook(book_id);
    expect(result.success).toBe(true);
    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    expect(book?.is_closed).toBe(0);
  });
});

describe('deleteBook', () => {
  it('removes from books list', async () => {
    const create = await useBookStore.getState().createBook({ name: 'ToDelete' });
    const book_id = (create as { success: true; data: { book_id: string } }).data.book_id;

    const result = await useBookStore.getState().deleteBook(book_id);
    expect(result.success).toBe(true);
    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    expect(book).toBeUndefined();
  });

  it('clears currentBook if it was the deleted book', async () => {
    const create = await useBookStore.getState().createBook({ name: 'DeleteCurrent' });
    const book_id = (create as { success: true; data: { book_id: string } }).data.book_id;

    await useBookStore.getState().openBook(book_id);
    expect(useBookStore.getState().currentBook?.book_id).toBe(book_id);

    await useBookStore.getState().deleteBook(book_id);
    expect(useBookStore.getState().currentBook).toBeNull();
  });
});

describe('Getters', () => {
  it('getActiveBooks returns only open books', async () => {
    await useBookStore.getState().createBook({ name: 'Active1' });
    const closed = await useBookStore.getState().createBook({ name: 'Closed1' });
    const closed_id = (closed as { success: true; data: { book_id: string } }).data.book_id;
    await useBookStore.getState().closeBook(closed_id);

    const active = useBookStore.getState().getActiveBooks();
    expect(active.every((b) => b.is_closed === 0)).toBe(true);
    expect(active.find((b) => b.name === 'Active1')).toBeDefined();
    expect(active.find((b) => b.name === 'Closed1')).toBeUndefined();
  });

  it('getClosedBooks returns only closed books', async () => {
    await useBookStore.getState().createBook({ name: 'Open2' });
    const closed = await useBookStore.getState().createBook({ name: 'Closed2' });
    const closed_id = (closed as { success: true; data: { book_id: string } }).data.book_id;
    await useBookStore.getState().closeBook(closed_id);

    const closedBooks = useBookStore.getState().getClosedBooks();
    expect(closedBooks.every((b) => b.is_closed === 1)).toBe(true);
    expect(closedBooks.find((b) => b.name === 'Closed2')).toBeDefined();
  });

  it('getAutoOpenBook returns null when no auto-open book', async () => {
    await useBookStore.getState().createBook({ name: 'Regular' });
    const autoOpen = useBookStore.getState().getAutoOpenBook();
    expect(autoOpen).toBeNull();
  });
});

describe('setAutoOpenBook', () => {
  it('sets is_auto_open to 1 on target book', async () => {
    const create = await useBookStore.getState().createBook({ name: 'AutoBook' });
    const book_id = (create as { success: true; data: { book_id: string } }).data.book_id;

    const result = await useBookStore.getState().setAutoOpenBook(book_id, true);
    expect(result.success).toBe(true);
    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    expect(book?.is_auto_open).toBe(1);
  });

  it('only one book can be auto-open at a time', async () => {
    const r1 = await useBookStore.getState().createBook({ name: 'Book1' });
    const r2 = await useBookStore.getState().createBook({ name: 'Book2' });
    const id1 = (r1 as { success: true; data: { book_id: string } }).data.book_id;
    const id2 = (r2 as { success: true; data: { book_id: string } }).data.book_id;

    await useBookStore.getState().setAutoOpenBook(id1, true);
    await useBookStore.getState().setAutoOpenBook(id2, true);

    const books = useBookStore.getState().books;
    expect(books.find((b) => b.book_id === id1)?.is_auto_open).toBe(0);
    expect(books.find((b) => b.book_id === id2)?.is_auto_open).toBe(1);
  });

  it('enable=false sets is_auto_open to 0', async () => {
    const create = await useBookStore.getState().createBook({ name: 'AutoOff' });
    const book_id = (create as { success: true; data: { book_id: string } }).data.book_id;

    await useBookStore.getState().setAutoOpenBook(book_id, true);
    await useBookStore.getState().setAutoOpenBook(book_id, false);

    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    expect(book?.is_auto_open).toBe(0);
  });

  it('getAutoOpenBook returns the auto-open book after setting', async () => {
    const create = await useBookStore.getState().createBook({ name: 'AutoFind' });
    const book_id = (create as { success: true; data: { book_id: string } }).data.book_id;

    await useBookStore.getState().setAutoOpenBook(book_id, true);
    const autoOpen = useBookStore.getState().getAutoOpenBook();
    expect(autoOpen?.book_id).toBe(book_id);
  });

  it('returns NOT_FOUND for nonexistent book', async () => {
    const result = await useBookStore.getState().setAutoOpenBook('nonexistent', true);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });
});

describe('forceRebalanceAndCloseBook', () => {
  it('returns PERMISSION_DENIED on already-closed book', async () => {
    const create = await useBookStore.getState().createBook({ name: 'ClosedBook' });
    const book_id = (create as { success: true; data: { book_id: string } }).data.book_id;
    await useLedgerStore.getState().fetchLedgers(book_id);
    await useBookStore.getState().closeBook(book_id);

    const result = await useBookStore.getState().forceRebalanceAndCloseBook(book_id);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('PERMISSION_DENIED');
    }
  });

  it('sets is_balanced=1 and is_closed=1 on book', async () => {
    const create = await useBookStore.getState().createBook({ name: 'ToBalance' });
    const book_id = (create as { success: true; data: { book_id: string } }).data.book_id;
    await useLedgerStore.getState().fetchLedgers(book_id);

    const result = await useBookStore.getState().forceRebalanceAndCloseBook(book_id);
    expect(result.success).toBe(true);

    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    expect(book?.is_balanced).toBe(1);
    expect(book?.is_closed).toBe(1);
  });

  it('creates adjustment entries for ledgers with non-zero balance', async () => {
    const { createQueries } = await import('@ledger/database');
    const create = await useBookStore.getState().createBook({ name: 'WithBalance' });
    const book_id = (create as { success: true; data: { book_id: string } }).data.book_id;

    const ledgerResult = await useLedgerStore.getState().createLedger({
      book_id,
      ledger_name: 'Cash',
    });
    const ledger_id = (ledgerResult as { success: true; data: { ledger_id: string } }).data.ledger_id;

    // Inject balance directly via query
    const q = createQueries(conn);
    await q.updateLedgerBalance(ledger_id, 100);
    // Sync store state
    await useLedgerStore.getState().fetchLedgers(book_id);

    const result = await useBookStore.getState().forceRebalanceAndCloseBook(book_id);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adjustments).toHaveLength(1);
      expect(result.data.adjustments[0].direction).toBe('sub');
      expect(result.data.adjustments[0].amount).toBe(100);
    }

    // Ledger balance should be 0 in store
    const ledger = useLedgerStore.getState().getLedger(ledger_id);
    expect(ledger?.balance).toBe(0);
  });

  it('returns empty adjustments when all balances are 0 but still closes book', async () => {
    const create = await useBookStore.getState().createBook({ name: 'ZeroBalance' });
    const book_id = (create as { success: true; data: { book_id: string } }).data.book_id;
    await useLedgerStore.getState().createLedger({ book_id, ledger_name: 'Empty' });
    await useLedgerStore.getState().fetchLedgers(book_id);

    const result = await useBookStore.getState().forceRebalanceAndCloseBook(book_id);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adjustments).toHaveLength(0);
    }

    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    expect(book?.is_closed).toBe(1);
  });
});
