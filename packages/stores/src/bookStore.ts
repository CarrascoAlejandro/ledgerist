import { create } from 'zustand';
import { buildOps, createQueries } from '@ledger/database';
import type { DBOperation } from '@ledger/database';
import { validateBookName } from '@ledger/shared';
import type { Book, ActionResult } from '@ledger/shared';
import { getDB } from './db.js';
import { useLedgerStore } from './ledgerStore.js';

interface BookState {
  books: Book[];
  currentBook: Book | null;
  loading: boolean;
  error: string | null;
}

interface BookActions {
  fetchBooks(): Promise<void>;
  createBook(input: { name: string }): Promise<ActionResult<Book>>;
  openBook(book_id: string): Promise<ActionResult<Book>>;
  renameBook(input: { book_id: string; name: string }): Promise<ActionResult<Book>>;
  closeBook(book_id: string): Promise<ActionResult<Book>>;
  reopenBook(book_id: string): Promise<ActionResult<Book>>;
  deleteBook(book_id: string): Promise<ActionResult>;
  setAutoOpenBook(book_id: string, enable: boolean): Promise<ActionResult<Book>>;
  forceRebalanceAndCloseBook(book_id: string): Promise<ActionResult<{
    adjustments: Array<{ ledger_id: string; ledger_name: string; amount: number; direction: 'add' | 'sub' }>;
  }>>;

  // Getters
  getBookById(id: string): Book | null;
  getActiveBooks(): Book[];
  getClosedBooks(): Book[];
  getAutoOpenBook(): Book | null;
}

export const useBookStore = create<BookState & BookActions>((set, get) => ({
  books: [],
  currentBook: null,
  loading: false,
  error: null,

  async fetchBooks() {
    set({ loading: true, error: null });
    try {
      const q = createQueries(getDB());
      const books = await q.getBooksWithLedgerCount();
      set({ books, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  async createBook({ name }) {
    const validation = validateBookName(name);
    if (!validation.valid) {
      // eslint-disable-next-line no-console
      console.warn('[store] createBook validation failed', {
        input: name,
        error: validation.error,
      });
      return { success: false, error: validation.error!, code: 'VALIDATION_ERROR' };
    }
    const trimmedName = validation.value!;

    const existing = get().books.find(
      (b) => b.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    if (existing) {
      // eslint-disable-next-line no-console
      console.warn('[store] createBook conflict', { name: trimmedName });
      return { success: false, error: 'A book with this name already exists', code: 'CONFLICT' };
    }

    try {
      // eslint-disable-next-line no-console
      console.info('[store] createBook inserting', { name: trimmedName });
      const q = createQueries(getDB());
      const book_id = crypto.randomUUID();
      await q.insertBook(book_id, trimmedName);
      await get().fetchBooks();
      const created = get().books.find((b) => b.book_id === book_id) ?? null;
      if (!created) {
        // eslint-disable-next-line no-console
        console.warn('[store] createBook insert missing after fetch', { book_id });
        return { success: false, error: 'Book not found after insert', code: 'DATABASE_ERROR' };
      }
      return { success: true, data: created };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[store] createBook failed', e);
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async openBook(book_id) {
    try {
      const q = createQueries(getDB());
      const book = await q.getBookById(book_id);
      if (!book) {
        return { success: false, error: 'Book not found', code: 'NOT_FOUND' };
      }
      set({ currentBook: book });
      return { success: true, data: book };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async renameBook({ book_id, name }) {
    const validation = validateBookName(name);
    if (!validation.valid) {
      return { success: false, error: validation.error!, code: 'VALIDATION_ERROR' };
    }
    const trimmedName = validation.value!;

    const conflict = get().books.find(
      (b) => b.book_id !== book_id && b.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    if (conflict) {
      return { success: false, error: 'A book with this name already exists', code: 'CONFLICT' };
    }

    try {
      const q = createQueries(getDB());
      await q.updateBookName(book_id, trimmedName);
      set((state) => ({
        books: state.books.map((b) =>
          b.book_id === book_id ? { ...b, name: trimmedName } : b,
        ),
        currentBook:
          state.currentBook?.book_id === book_id
            ? { ...state.currentBook, name: trimmedName }
            : state.currentBook,
      }));
      const updated = get().books.find((b) => b.book_id === book_id) ?? null;
      if (!updated) {
        return { success: false, error: 'Book not found after rename', code: 'NOT_FOUND' };
      }
      return { success: true, data: updated };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async closeBook(book_id) {
    try {
      const q = createQueries(getDB());
      await q.setBookClosed(book_id, 1);
      set((state) => ({
        books: state.books.map((b) =>
          b.book_id === book_id ? { ...b, is_closed: 1 } : b,
        ),
        currentBook:
          state.currentBook?.book_id === book_id
            ? { ...state.currentBook, is_closed: 1 }
            : state.currentBook,
      }));
      const updated = get().books.find((b) => b.book_id === book_id) ?? null;
      if (!updated) {
        return { success: false, error: 'Book not found', code: 'NOT_FOUND' };
      }
      return { success: true, data: updated };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async reopenBook(book_id) {
    try {
      const q = createQueries(getDB());
      await q.setBookClosed(book_id, 0);
      set((state) => ({
        books: state.books.map((b) =>
          b.book_id === book_id ? { ...b, is_closed: 0 } : b,
        ),
        currentBook:
          state.currentBook?.book_id === book_id
            ? { ...state.currentBook, is_closed: 0 }
            : state.currentBook,
      }));
      const updated = get().books.find((b) => b.book_id === book_id) ?? null;
      if (!updated) {
        return { success: false, error: 'Book not found', code: 'NOT_FOUND' };
      }
      return { success: true, data: updated };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async deleteBook(book_id) {
    try {
      const db = getDB();
      await db.transaction([
        buildOps.softDeleteEntriesByBook(book_id),
        buildOps.softDeleteLedgersByBook(book_id),
        buildOps.softDeleteBook(book_id),
      ]);
      set((state) => ({
        books: state.books.filter((b) => b.book_id !== book_id),
        currentBook:
          state.currentBook?.book_id === book_id ? null : state.currentBook,
      }));
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async setAutoOpenBook(book_id, enable) {
    const book = get().books.find((b) => b.book_id === book_id);
    if (!book) {
      return { success: false, error: 'Book not found', code: 'NOT_FOUND' };
    }
    try {
      const q = createQueries(getDB());
      if (enable) {
        // Clear any other auto-open book first
        for (const b of get().books) {
          if (b.book_id !== book_id && b.is_auto_open === 1) {
            await q.setBookAutoOpen(b.book_id, 0);
          }
        }
        await q.setBookAutoOpen(book_id, 1);
        set((state) => ({
          books: state.books.map((b) => ({ ...b, is_auto_open: b.book_id === book_id ? 1 : 0 })),
          currentBook:
            state.currentBook
              ? { ...state.currentBook, is_auto_open: state.currentBook.book_id === book_id ? 1 : 0 }
              : null,
        }));
      } else {
        await q.setBookAutoOpen(book_id, 0);
        set((state) => ({
          books: state.books.map((b) =>
            b.book_id === book_id ? { ...b, is_auto_open: 0 } : b,
          ),
          currentBook:
            state.currentBook?.book_id === book_id
              ? { ...state.currentBook, is_auto_open: 0 }
              : state.currentBook,
        }));
      }
      const updated = get().books.find((b) => b.book_id === book_id) ?? null;
      if (!updated) {
        return { success: false, error: 'Book not found after update', code: 'NOT_FOUND' };
      }
      return { success: true, data: updated };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async forceRebalanceAndCloseBook(book_id) {
    const book = get().books.find((b) => b.book_id === book_id);
    if (!book) {
      return { success: false, error: 'Book not found', code: 'NOT_FOUND' };
    }
    if (book.is_closed === 1) {
      return { success: false, error: 'Book is already closed', code: 'PERMISSION_DENIED' };
    }

    try {
      const db = getDB();
      const ledgers = useLedgerStore.getState().getLedgersForBook(book_id);
      const unbalanced = ledgers.filter((l) => l.balance !== 0);

      const adjustments: Array<{ ledger_id: string; ledger_name: string; amount: number; direction: 'add' | 'sub' }> =
        unbalanced.map((l) => ({
          ledger_id: l.ledger_id,
          ledger_name: l.ledger_name,
          amount: Math.abs(l.balance),
          direction: l.balance > 0 ? 'sub' : 'add',
        }));

      const today = new Date().toISOString().slice(0, 10);
      const ops: DBOperation[] = [];

      for (const adj of adjustments) {
        const entry_id = crypto.randomUUID();
        ops.push(
          buildOps.insertEntry(entry_id, {
            ledger_id: adj.ledger_id,
            book_id,
            entry_date: today,
            detail: 'Balance adjustment',
            amount: adj.amount,
            cat_direction: adj.direction,
            transfer_group_id: null,
          }),
        );
        ops.push(buildOps.updateLedgerBalance(adj.ledger_id, 0));
      }

      ops.push(buildOps.setBookBalancedAndClosed(book_id));

      await db.transaction(ops);

      // Patch ledger balances to 0
      if (unbalanced.length > 0) {
        const adjustedIds = new Set(unbalanced.map((l) => l.ledger_id));
        useLedgerStore.setState((state) => ({
          ledgers: state.ledgers.map((l) =>
            adjustedIds.has(l.ledger_id) ? { ...l, balance: 0 } : l,
          ),
        }));
      }

      set((state) => ({
        books: state.books.map((b) =>
          b.book_id === book_id ? { ...b, is_balanced: 1, is_closed: 1 } : b,
        ),
        currentBook:
          state.currentBook?.book_id === book_id
            ? { ...state.currentBook, is_balanced: 1, is_closed: 1 }
            : state.currentBook,
      }));

      return { success: true, data: { adjustments } };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  getBookById(id) {
    return get().books.find((b) => b.book_id === id) ?? null;
  },

  getActiveBooks() {
    return get().books.filter((b) => b.is_closed === 0);
  },

  getClosedBooks() {
    return get().books.filter((b) => b.is_closed === 1);
  },

  getAutoOpenBook() {
    return get().books.find((b) => b.is_auto_open === 1) ?? null;
  },
}));
