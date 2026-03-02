import { create } from 'zustand';
import { createQueries } from '@ledger/database';
import { validateLedgerName } from '@ledger/shared';
import type { Ledger, ActionResult } from '@ledger/shared';
import { getDB } from './db.js';
import { useBookStore } from './bookStore.js';

const EMOJI_POOL = [
  '💰', '💵', '🏦', '📊', '🛒', '🏠', '🚗', '✈️', '🎓', '💊',
  '🎬', '☕', '🍔', '👔', '🎮', '💡', '📱', '🏥', '🎁', '💳',
];

function randomEmoji(): string {
  return EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
}

interface LedgerState {
  ledgers: Ledger[];
  currentBook_id: string | null;
  collapsed: Record<string, boolean>;
  loading: boolean;
  error: string | null;
}

interface LedgerActions {
  fetchLedgers(book_id: string): Promise<void>;
  createLedger(input: {
    book_id: string;
    ledger_name: string;
    icon?: string;
  }): Promise<ActionResult<Ledger>>;
  toggleLedgerCollapse(ledger_id: string): void;
  renameLedger(input: { ledger_id: string; ledger_name: string }): Promise<ActionResult<Ledger>>;
  setLedgerAlias(input: {
    ledger_id: string;
    alias: string | null;
    book_id: string;
  }): Promise<ActionResult<Ledger>>;
  deleteLedger(input: { ledger_id: string; book_id: string }): Promise<ActionResult>;

  // Getters
  getLedger(id: string): Ledger | null;
  getLedgersForBook(book_id: string): Ledger[];
  getLedgerByAlias(book_id: string, alias: string): Ledger | null;
  isAliasAvailable(book_id: string, alias: string, excludeId?: string): boolean;
  getTotalBookBalance(book_id: string): number;
}

export const useLedgerStore = create<LedgerState & LedgerActions>((set, get) => ({
  ledgers: [],
  currentBook_id: null,
  collapsed: {},
  loading: false,
  error: null,

  async fetchLedgers(book_id) {
    set({ loading: true, error: null });
    try {
      const q = createQueries(getDB());
      const ledgers = await q.getLedgers(book_id);
      const collapsed: Record<string, boolean> = {};
      for (const l of ledgers) {
        collapsed[l.ledger_id] = false;
      }
      set({ ledgers, currentBook_id: book_id, collapsed, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  async createLedger({ book_id, ledger_name, icon }) {
    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    if (!book) {
      return { success: false, error: 'Book not found', code: 'NOT_FOUND' };
    }
    if (book.is_closed) {
      return { success: false, error: 'Cannot add ledger to a closed book', code: 'PERMISSION_DENIED' };
    }

    const validation = validateLedgerName(ledger_name);
    if (!validation.valid) {
      return { success: false, error: validation.error!, code: 'VALIDATION_ERROR' };
    }

    try {
      const q = createQueries(getDB());
      const ledger_id = crypto.randomUUID();
      const resolvedIcon = icon ?? randomEmoji();
      await q.insertLedger(ledger_id, book_id, validation.value!, resolvedIcon);
      await get().fetchLedgers(book_id);
      const created = get().ledgers.find((l) => l.ledger_id === ledger_id) ?? null;
      if (!created) {
        return { success: false, error: 'Ledger not found after insert', code: 'DATABASE_ERROR' };
      }
      return { success: true, data: created };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  toggleLedgerCollapse(ledger_id) {
    set((state) => ({
      collapsed: {
        ...state.collapsed,
        [ledger_id]: !state.collapsed[ledger_id],
      },
    }));
  },

  async renameLedger({ ledger_id, ledger_name }) {
    const ledger = get().ledgers.find((l) => l.ledger_id === ledger_id);
    if (!ledger) {
      return { success: false, error: 'Ledger not found', code: 'NOT_FOUND' };
    }

    const book = useBookStore.getState().books.find((b) => b.book_id === ledger.book_id);
    if (book?.is_closed) {
      return { success: false, error: 'Cannot rename ledger in a closed book', code: 'PERMISSION_DENIED' };
    }

    const validation = validateLedgerName(ledger_name);
    if (!validation.valid) {
      return { success: false, error: validation.error!, code: 'VALIDATION_ERROR' };
    }

    try {
      const q = createQueries(getDB());
      await q.updateLedgerName(ledger_id, validation.value!);
      set((state) => ({
        ledgers: state.ledgers.map((l) =>
          l.ledger_id === ledger_id ? { ...l, ledger_name: validation.value! } : l,
        ),
      }));
      const updated = get().ledgers.find((l) => l.ledger_id === ledger_id) ?? null;
      if (!updated) {
        return { success: false, error: 'Ledger not found after rename', code: 'NOT_FOUND' };
      }
      return { success: true, data: updated };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async setLedgerAlias({ ledger_id, alias, book_id }) {
    const ledger = get().ledgers.find((l) => l.ledger_id === ledger_id);
    if (!ledger) {
      return { success: false, error: 'Ledger not found', code: 'NOT_FOUND' };
    }

    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    if (book?.is_closed) {
      return { success: false, error: 'Cannot update alias in a closed book', code: 'PERMISSION_DENIED' };
    }

    if (alias !== null && alias.trim() !== '') {
      const normalizedAlias = alias.trim().toLowerCase();
      if (!get().isAliasAvailable(book_id, normalizedAlias, ledger_id)) {
        return { success: false, error: 'Alias already in use in this book', code: 'VALIDATION_ERROR' };
      }
    }

    try {
      const q = createQueries(getDB());
      const resolvedAlias = alias === null || alias.trim() === '' ? null : alias.trim().toLowerCase();
      await q.updateLedgerAlias(ledger_id, resolvedAlias);
      set((state) => ({
        ledgers: state.ledgers.map((l) =>
          l.ledger_id === ledger_id ? { ...l, alias: resolvedAlias } : l,
        ),
      }));
      const updated = get().ledgers.find((l) => l.ledger_id === ledger_id) ?? null;
      if (!updated) {
        return { success: false, error: 'Ledger not found after update', code: 'NOT_FOUND' };
      }
      return { success: true, data: updated };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async deleteLedger({ ledger_id, book_id }) {
    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    if (book?.is_closed) {
      return { success: false, error: 'Cannot delete ledger from a closed book', code: 'PERMISSION_DENIED' };
    }

    try {
      const db = getDB();
      await db.transaction([
        {
          sql: `UPDATE entries SET status = 0, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
          params: [ledger_id],
        },
        {
          sql: `UPDATE ledgers SET status = 0, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
          params: [ledger_id],
        },
      ]); // TODO: SQL should be in queries file, not here
      set((state) => ({
        ledgers: state.ledgers.filter((l) => l.ledger_id !== ledger_id),
      }));
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  getLedger(id) {
    return get().ledgers.find((l) => l.ledger_id === id) ?? null;
  },

  getLedgersForBook(book_id) {
    return get().ledgers.filter((l) => l.book_id === book_id);
  },

  getLedgerByAlias(book_id, alias) {
    const lower = alias.toLowerCase();
    return (
      get().ledgers.find(
        (l) => l.book_id === book_id && l.alias?.toLowerCase() === lower,
      ) ?? null
    );
  },

  isAliasAvailable(book_id, alias, excludeId) {
    const lower = alias.toLowerCase();
    return !get().ledgers.some(
      (l) =>
        l.book_id === book_id &&
        l.alias?.toLowerCase() === lower &&
        l.ledger_id !== excludeId,
    );
  },

  getTotalBookBalance(book_id) {
    return get()
      .ledgers.filter((l) => l.book_id === book_id)
      .reduce((sum, l) => sum + l.balance, 0);
  },
}));
