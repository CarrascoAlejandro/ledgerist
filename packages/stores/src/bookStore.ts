import { create } from 'zustand';
import { createQueries } from '@ledger/database';
import { validateBookName } from '@ledger/shared';
import type { Book, ActionResult } from '@ledger/shared';
import { getDB } from './db.js';

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
        {
          sql: `UPDATE entries SET status = 0, updated_at = datetime('now','utc') WHERE book_id = ?`,
          params: [book_id],
        },
        {
          sql: `UPDATE ledgers SET status = 0, updated_at = datetime('now','utc') WHERE book_id = ?`,
          params: [book_id],
        },
        {
          sql: `UPDATE books SET status = 0, updated_at = datetime('now','utc') WHERE book_id = ?`,
          params: [book_id],
        },
      ]); // TODO: SQL should be in queries file, not here
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
