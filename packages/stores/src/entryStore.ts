import { create } from 'zustand';
import { createQueries } from '@ledger/database';
import {
  validateAmount,
  validateISODate,
  parseDateToken,
  roundAmount,
  applyEntryToBalance,
  reverseEntryFromBalance,
  todayISO,
} from '@ledger/shared';
import type { Entry, Ledger, EntryDirection, ActionResult } from '@ledger/shared';
import type { CreateEntryInput } from '@ledger/shared';
import { getDB } from './db.js';
import { useBookStore } from './bookStore.js';
import { useLedgerStore } from './ledgerStore.js';

interface StoreParserPreview {
  raw: string;
  parsed_date: string | null;
  parsed_ledger: Ledger | null;
  parsed_amount: number | null;
  parsed_direction: EntryDirection | null;
  parsed_detail: string | null;
  is_transfer: boolean;
  resolved_transfer_target: Ledger | null;
  errors: string[];
  warnings: string[];
}

interface ParseTextInputParams {
  input: string;
  book_id: string;
  defaultDirection: EntryDirection;
  weekStartDay: number;
  weekendStartDay: number;
}

interface SubmitParsedEntryParams {
  book_id: string;
  preview: StoreParserPreview;
  overrides?: {
    entry_date?: string;
    amount?: number;
    cat_direction?: EntryDirection;
    detail?: string | null;
    parsed_ledger?: Ledger;
    resolved_transfer_target?: Ledger;
  };
}

interface EntryState {
  entries: Entry[];
  currentBook_id: string | null;
  parserPreview: StoreParserPreview | null;
  parserInput: string;
  loading: boolean;
  error: string | null;
}

interface EntryActions {
  fetchEntriesForLedger(ledger_id: string): Promise<void>;
  fetchEntriesForBook(book_id: string): Promise<void>;
  addEntry(data: CreateEntryInput): Promise<ActionResult<Entry>>;
  editEntry(params: {
    entry_id: string;
    book_id: string;
    updates: {
      entry_date?: string;
      detail?: string | null;
      amount?: number;
      cat_direction?: EntryDirection;
    };
  }): Promise<ActionResult<Entry>>;
  deleteEntry(params: { entry_id: string; book_id: string }): Promise<ActionResult>;
  parseTextInput(params: ParseTextInputParams): void;
  submitParsedEntry(params: SubmitParsedEntryParams): Promise<ActionResult<Entry[]>>;
  updateParserInput(
    input: string,
    context: {
      book_id: string;
      defaultDirection: EntryDirection;
      weekStartDay: number;
      weekendStartDay: number;
    },
  ): void;
  clearParserState(): void;

  // Getters
  getEntriesForLedger(ledger_id: string): Entry[];
  getEntriesForBook(book_id: string): Entry[];
  getTransferPair(entry_id: string): Entry | null;
  calculateLedgerBalance(ledger_id: string): number;
}

export const useEntryStore = create<EntryState & EntryActions>((set, get) => ({
  entries: [],
  currentBook_id: null,
  parserPreview: null,
  parserInput: '',
  loading: false,
  error: null,

  async fetchEntriesForLedger(ledger_id) {
    set({ loading: true, error: null });
    try {
      const q = createQueries(getDB());
      const entries = await q.getEntriesByLedger(ledger_id);
      set({ entries, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  async fetchEntriesForBook(book_id) {
    set({ loading: true, error: null });
    try {
      const q = createQueries(getDB());
      const entries = await q.getEntriesByBook(book_id);
      set({ entries, currentBook_id: book_id, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  async addEntry(data) {
    const book = useBookStore.getState().books.find((b) => b.book_id === data.book_id);
    if (!book) {
      return { success: false, error: 'Book not found', code: 'NOT_FOUND' };
    }
    if (book.is_closed) {
      return { success: false, error: 'Book is closed', code: 'PERMISSION_DENIED' };
    }

    const ledger = useLedgerStore
      .getState()
      .ledgers.find((l) => l.ledger_id === data.ledger_id && l.book_id === data.book_id);
    if (!ledger) {
      return { success: false, error: 'Ledger not found in book', code: 'NOT_FOUND' };
    }

    const amountResult = validateAmount(data.amount);
    if (!amountResult.valid) {
      return { success: false, error: amountResult.error!, code: 'VALIDATION_ERROR' };
    }

    const dateResult = validateISODate(data.entry_date);
    if (!dateResult.valid) {
      return { success: false, error: dateResult.error!, code: 'VALIDATION_ERROR' };
    }

    try {
      const db = getDB();
      const q = createQueries(db);
      const entry_id = crypto.randomUUID();
      const newBalance = applyEntryToBalance(ledger.balance, data.amount, data.cat_direction);

      await db.transaction([
        {
          sql: `INSERT INTO entries
                  (entry_id, ledger_id, book_id, entry_date, detail, amount, cat_direction, transfer_group_id, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          params: [
            entry_id,
            data.ledger_id,
            data.book_id,
            data.entry_date,
            data.detail ?? null,
            data.amount,
            data.cat_direction,
            data.transfer_group_id ?? null,
          ],
        },
        {
          sql: `UPDATE ledgers SET balance = ?, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
          params: [newBalance, data.ledger_id],
        }, // TODO: SQL should be in queries file, not here
      ]);

      const entry = await q.getEntryById(entry_id);
      if (!entry) {
        return { success: false, error: 'Entry not found after insert', code: 'DATABASE_ERROR' };
      }

      set((state) => ({ entries: [entry, ...state.entries] }));

      useLedgerStore.setState((state) => ({
        ledgers: state.ledgers.map((l) =>
          l.ledger_id === data.ledger_id ? { ...l, balance: newBalance } : l,
        ),
      }));

      return { success: true, data: entry };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async editEntry({ entry_id, book_id, updates }) {
    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    if (!book) {
      return { success: false, error: 'Book not found', code: 'NOT_FOUND' };
    }
    if (book.is_closed) {
      return { success: false, error: 'Book is closed', code: 'PERMISSION_DENIED' };
    }

    try {
      const db = getDB();
      const q = createQueries(db);

      const entry = await q.getEntryById(entry_id);
      if (!entry) {
        return { success: false, error: 'Entry not found', code: 'NOT_FOUND' };
      }

      // Validate transfer pair
      if (entry.transfer_group_id) {
        const group = await q.getTransferGroup(entry.transfer_group_id);
        const paired = group.find((e) => e.entry_id !== entry_id);
        if (paired) {
          const pairedBook = useBookStore
            .getState()
            .books.find((b) => b.book_id === paired.book_id);
          if (pairedBook?.is_closed) {
            return {
              success: false,
              error: 'Cannot edit: paired transfer entry is in a closed book',
              code: 'PERMISSION_DENIED',
            };
          }
        }
      }

      const newAmount = updates.amount ?? entry.amount;
      const newDirection = updates.cat_direction ?? entry.cat_direction;

      const ledger = useLedgerStore
        .getState()
        .ledgers.find((l) => l.ledger_id === entry.ledger_id);
      if (!ledger) {
        return { success: false, error: 'Ledger not found', code: 'NOT_FOUND' };
      }

      let newBalance = reverseEntryFromBalance(ledger.balance, entry.amount, entry.cat_direction);
      newBalance = applyEntryToBalance(newBalance, newAmount, newDirection);

      // Build UPDATE SQL for entry fields
      const entryParts: string[] = [];
      const entryParams: unknown[] = [];
      if (updates.entry_date !== undefined) {
        entryParts.push('entry_date = ?');
        entryParams.push(updates.entry_date);
      }
      if (updates.detail !== undefined) {
        entryParts.push('detail = ?');
        entryParams.push(updates.detail);
      }
      if (updates.amount !== undefined) {
        entryParts.push('amount = ?');
        entryParams.push(updates.amount);
      }
      if (updates.cat_direction !== undefined) {
        entryParts.push('cat_direction = ?');
        entryParams.push(updates.cat_direction);
      }

      const ops: Array<{ sql: string; params?: unknown[] }> = [];

      if (entryParts.length > 0) {
        entryParts.push("updated_at = datetime('now','utc')");
        entryParams.push(entry_id);
        ops.push({
          sql: `UPDATE entries SET ${entryParts.join(', ')} WHERE entry_id = ?`,
          params: entryParams,
        });
      }

      ops.push({
        sql: `UPDATE ledgers SET balance = ?, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
        params: [newBalance, entry.ledger_id],
      });

      // Sync transfer pair amount if changed
      if (entry.transfer_group_id && updates.amount !== undefined) {
        const group = await q.getTransferGroup(entry.transfer_group_id);
        const paired = group.find((e) => e.entry_id !== entry_id);
        if (paired) {
          const pairedLedger = useLedgerStore
            .getState()
            .ledgers.find((l) => l.ledger_id === paired.ledger_id);
          if (pairedLedger) {
            let pairedBalance = reverseEntryFromBalance(
              pairedLedger.balance,
              paired.amount,
              paired.cat_direction,
            );
            pairedBalance = applyEntryToBalance(pairedBalance, newAmount, paired.cat_direction);
            ops.push({
              sql: `UPDATE entries SET amount = ?, updated_at = datetime('now','utc') WHERE entry_id = ?`,
              params: [newAmount, paired.entry_id],
            });
            ops.push({
              sql: `UPDATE ledgers SET balance = ?, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
              params: [pairedBalance, paired.ledger_id],
            });
          }
        }
      }

      await db.transaction(ops);

      const updatedEntry = await q.getEntryById(entry_id);
      if (!updatedEntry) {
        return { success: false, error: 'Entry not found after update', code: 'DATABASE_ERROR' };
      }

      set((state) => ({
        entries: state.entries.map((e) => (e.entry_id === entry_id ? updatedEntry : e)),
      }));

      useLedgerStore.setState((state) => ({
        ledgers: state.ledgers.map((l) =>
          l.ledger_id === entry.ledger_id ? { ...l, balance: newBalance } : l,
        ),
      }));

      return { success: true, data: updatedEntry };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async deleteEntry({ entry_id, book_id }) {
    const book = useBookStore.getState().books.find((b) => b.book_id === book_id);
    if (!book) {
      return { success: false, error: 'Book not found', code: 'NOT_FOUND' };
    }
    if (book.is_closed) {
      return { success: false, error: 'Book is closed', code: 'PERMISSION_DENIED' };
    }

    try {
      const db = getDB();
      const q = createQueries(db);

      const entry = await q.getEntryById(entry_id);
      if (!entry) {
        return { success: false, error: 'Entry not found', code: 'NOT_FOUND' };
      }

      const ledger = useLedgerStore
        .getState()
        .ledgers.find((l) => l.ledger_id === entry.ledger_id);
      if (!ledger) {
        return { success: false, error: 'Ledger not found', code: 'NOT_FOUND' };
      }

      const newBalance = reverseEntryFromBalance(ledger.balance, entry.amount, entry.cat_direction);

      const ops: Array<{ sql: string; params?: unknown[] }> = [
        {
          sql: `UPDATE entries SET status = 0, updated_at = datetime('now','utc') WHERE entry_id = ?`,
          params: [entry_id],
        },
        {
          sql: `UPDATE ledgers SET balance = ?, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
          params: [newBalance, entry.ledger_id],
        },
      ];

      const deletedIds = new Set([entry_id]);
      const balanceUpdates: Array<{ ledger_id: string; balance: number }> = [
        { ledger_id: entry.ledger_id, balance: newBalance },
      ];

      // Handle transfer pair
      if (entry.transfer_group_id) {
        const group = await q.getTransferGroup(entry.transfer_group_id);
        const paired = group.find((e) => e.entry_id !== entry_id);
        if (paired) {
          const pairedBook = useBookStore
            .getState()
            .books.find((b) => b.book_id === paired.book_id);
          if (pairedBook?.is_closed) {
            return {
              success: false,
              error: 'Cannot delete: paired transfer entry is in a closed book',
              code: 'PERMISSION_DENIED',
            };
          }
          const pairedLedger = useLedgerStore
            .getState()
            .ledgers.find((l) => l.ledger_id === paired.ledger_id);
          if (pairedLedger) {
            const pairedBalance = reverseEntryFromBalance(
              pairedLedger.balance,
              paired.amount,
              paired.cat_direction,
            );
            ops.push({
              sql: `UPDATE entries SET status = 0, updated_at = datetime('now','utc') WHERE entry_id = ?`,
              params: [paired.entry_id],
            });
            ops.push({
              sql: `UPDATE ledgers SET balance = ?, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
              params: [pairedBalance, paired.ledger_id],
            });
            deletedIds.add(paired.entry_id);
            balanceUpdates.push({ ledger_id: paired.ledger_id, balance: pairedBalance });
          }
        }
      }

      await db.transaction(ops);

      set((state) => ({
        entries: state.entries.filter((e) => !deletedIds.has(e.entry_id)),
      }));

      useLedgerStore.setState((state) => ({
        ledgers: state.ledgers.map((l) => {
          const update = balanceUpdates.find((u) => u.ledger_id === l.ledger_id);
          return update ? { ...l, balance: update.balance } : l;
        }),
      }));

      return { success: true };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  parseTextInput({ input, book_id, defaultDirection, weekStartDay, weekendStartDay }) {
    if (!input.trim()) {
      set({ parserPreview: null, parserInput: input });
      return;
    }

    const tokens = input.trim().split(/\s+/);
    const used = new Set<number>();
    const errors: string[] = [];
    const warnings: string[] = [];

    const lowerTokens = tokens.map((t) => t.toLowerCase());
    const isTransfer =
      lowerTokens.includes('transfer') && lowerTokens.includes('to');

    let parsedDate: string | null = null;
    let parsedLedger: Ledger | null = null;
    let parsedAmount: number | null = null;
    let parsedDirection: EntryDirection | null = null;
    let resolvedTransferTarget: Ledger | null = null;

    const { ledgers } = useLedgerStore.getState();
    const bookLedgers = ledgers.filter((l) => l.book_id === book_id && l.status === 1);

    // ── Date detection (try 2-token phrases first, then single tokens) ──
    for (let i = 0; i < tokens.length; i++) {
      if (used.has(i)) continue;

      // Try 2-token phrase (e.g. "next week", "last weekend")
      if (i + 1 < tokens.length && !used.has(i + 1)) {
        const twoToken = tokens[i] + ' ' + tokens[i + 1];
        const result = parseDateToken(twoToken, weekStartDay, weekendStartDay);
        if (result) {
          parsedDate = result;
          used.add(i);
          used.add(i + 1);
          break;
        }
      }

      // Try single token
      const result = parseDateToken(tokens[i], weekStartDay, weekendStartDay);
      if (result) {
        parsedDate = result;
        used.add(i);
        break;
      }
    }

    // ── Ledger reference detection ──
    const resolvedLedger = (token: string): Ledger | null => {
      if (token.startsWith('#')) {
        const alias = token.slice(1).toLowerCase();
        return (
          bookLedgers.find((l) => l.alias?.toLowerCase() === alias) ??
          bookLedgers.find((l) => l.ledger_name.toLowerCase() === alias) ??
          null
        );
      }
      const lower = token.toLowerCase();
      return bookLedgers.find((l) => l.ledger_name.toLowerCase() === lower) ?? null;
    };

    if (isTransfer) {
      const toIdx = lowerTokens.indexOf('to');

      // Source ledger: search before "to"
      for (let i = 0; i < toIdx; i++) {
        if (used.has(i)) continue;
        if (tokens[i].startsWith('#')) {
          const found = resolvedLedger(tokens[i]);
          if (found) {
            parsedLedger = found;
            used.add(i);
            break;
          }
        }
      }

      // Target ledger: search after "to"
      for (let i = toIdx + 1; i < tokens.length; i++) {
        if (used.has(i)) continue;
        if (tokens[i].startsWith('#')) {
          const found = resolvedLedger(tokens[i]);
          if (found) {
            resolvedTransferTarget = found;
            used.add(i);
            break;
          }
        }
      }

      // Mark transfer/to keywords as used
      lowerTokens.forEach((t, i) => {
        if (t === 'transfer' || t === 'to') used.add(i);
      });
    } else {
      // Non-transfer: find first ledger ref
      for (let i = 0; i < tokens.length; i++) {
        if (used.has(i)) continue;
        const found = resolvedLedger(tokens[i]);
        if (found) {
          parsedLedger = found;
          used.add(i);
          break;
        }
      }
    }

    // ── Amount and direction detection ──
    for (let i = 0; i < tokens.length; i++) {
      if (used.has(i)) continue;
      const lower = lowerTokens[i];

      if (lower === 'add' || lower === '+') {
        parsedDirection = 'add';
        used.add(i);
        continue;
      }
      if (lower === 'sub' || lower === '-') {
        parsedDirection = 'sub';
        used.add(i);
        continue;
      }

      // +/- prefix on amount (e.g. "+50", "-25.00")
      if ((lower.startsWith('+') || lower.startsWith('-')) && lower.length > 1) {
        const dir: EntryDirection = lower.startsWith('+') ? 'add' : 'sub';
        const amountStr = tokens[i].slice(1).replace(/[$€£,]/g, '');
        const num = parseFloat(amountStr);
        if (isFinite(num) && num > 0) {
          parsedDirection = dir;
          parsedAmount = roundAmount(num);
          used.add(i);
          continue;
        }
      }

      // Plain amount (e.g. "$50", "25.00", "1,000")
      if (parsedAmount === null) {
        const amountStr = tokens[i].replace(/[$€£,]/g, '');
        const num = parseFloat(amountStr);
        if (isFinite(num) && num > 0) {
          parsedAmount = roundAmount(num);
          used.add(i);
        }
      }
    }

    if (parsedDirection === null) parsedDirection = defaultDirection;

    // ── Detail: remaining unused tokens ──
    const detailTokens = tokens.filter((_, i) => !used.has(i));
    const parsedDetail = detailTokens.length > 0 ? detailTokens.join(' ') : null;

    // ── Validation warnings/errors ──
    if (!parsedDate) warnings.push("No date detected; will use today's date");
    if (!isTransfer && !parsedLedger) warnings.push('No ledger detected');
    if (isTransfer && !parsedLedger) errors.push('Transfer requires a source ledger (use #alias)');
    if (isTransfer && !resolvedTransferTarget)
      errors.push('Transfer requires a target ledger (use #alias)');
    if (!parsedAmount) warnings.push('No amount detected');

    set({
      parserInput: input,
      parserPreview: {
        raw: input,
        parsed_date: parsedDate,
        parsed_ledger: parsedLedger,
        parsed_amount: parsedAmount,
        parsed_direction: parsedDirection,
        parsed_detail: parsedDetail,
        is_transfer: isTransfer,
        resolved_transfer_target: resolvedTransferTarget,
        errors,
        warnings,
      },
    });
  },

  async submitParsedEntry({ book_id, preview, overrides }) {
    const entry_date = overrides?.entry_date ?? preview.parsed_date ?? todayISO();
    const amount = overrides?.amount ?? preview.parsed_amount;
    const detail =
      overrides !== undefined && 'detail' in overrides
        ? overrides.detail
        : preview.parsed_detail;
    const sourceLedger = overrides?.parsed_ledger ?? preview.parsed_ledger;

    if (!amount || amount <= 0) {
      return { success: false, error: 'Amount is required', code: 'VALIDATION_ERROR' };
    }
    if (!sourceLedger) {
      return { success: false, error: 'Ledger is required', code: 'VALIDATION_ERROR' };
    }

    if (!preview.is_transfer) {
      const direction = overrides?.cat_direction ?? preview.parsed_direction ?? 'sub';
      const result = await get().addEntry({
        book_id,
        ledger_id: sourceLedger.ledger_id,
        entry_date,
        amount,
        cat_direction: direction,
        detail: detail ?? null,
      });
      if (!result.success) return { success: false, error: result.error, code: result.code };
      get().clearParserState();
      return { success: true, data: [result.data!] };
    }

    // Transfer
    const targetLedger =
      overrides?.resolved_transfer_target ?? preview.resolved_transfer_target;
    if (!targetLedger) {
      return {
        success: false,
        error: 'Transfer target ledger is required',
        code: 'VALIDATION_ERROR',
      };
    }

    const transfer_group_id = crypto.randomUUID();
    const sourceEntryId = crypto.randomUUID();
    const targetEntryId = crypto.randomUUID();
    const db = getDB();
    const q = createQueries(db);

    const { ledgers } = useLedgerStore.getState();
    const srcLedgerState = ledgers.find((l) => l.ledger_id === sourceLedger.ledger_id);
    const tgtLedgerState = ledgers.find((l) => l.ledger_id === targetLedger.ledger_id);

    if (!srcLedgerState) {
      return { success: false, error: 'Source ledger not found', code: 'NOT_FOUND' };
    }
    if (!tgtLedgerState) {
      return { success: false, error: 'Target ledger not found', code: 'NOT_FOUND' };
    }

    const newSourceBalance = applyEntryToBalance(srcLedgerState.balance, amount, 'sub');
    const newTargetBalance = applyEntryToBalance(tgtLedgerState.balance, amount, 'add');

    try {
      await db.transaction([
        {
          sql: `INSERT INTO entries
                  (entry_id, ledger_id, book_id, entry_date, detail, amount, cat_direction, transfer_group_id, status)
                VALUES (?, ?, ?, ?, ?, ?, 'sub', ?, 1)`,
          params: [
            sourceEntryId,
            sourceLedger.ledger_id,
            book_id,
            entry_date,
            detail ?? null,
            amount,
            transfer_group_id,
          ],
        },
        {
          sql: `INSERT INTO entries
                  (entry_id, ledger_id, book_id, entry_date, detail, amount, cat_direction, transfer_group_id, status)
                VALUES (?, ?, ?, ?, ?, ?, 'add', ?, 1)`,
          params: [
            targetEntryId,
            targetLedger.ledger_id,
            book_id,
            entry_date,
            detail ?? null,
            amount,
            transfer_group_id,
          ],
        },
        {
          sql: `UPDATE ledgers SET balance = ?, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
          params: [newSourceBalance, sourceLedger.ledger_id],
        },
        {
          sql: `UPDATE ledgers SET balance = ?, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
          params: [newTargetBalance, targetLedger.ledger_id],
        },
      ]);

      const [srcEntry, tgtEntry] = await Promise.all([
        q.getEntryById(sourceEntryId),
        q.getEntryById(targetEntryId),
      ]);

      if (!srcEntry || !tgtEntry) {
        return {
          success: false,
          error: 'Entries not found after insert',
          code: 'DATABASE_ERROR',
        };
      }

      set((state) => ({ entries: [srcEntry, tgtEntry, ...state.entries] }));

      useLedgerStore.setState((state) => ({
        ledgers: state.ledgers.map((l) => {
          if (l.ledger_id === sourceLedger.ledger_id) return { ...l, balance: newSourceBalance };
          if (l.ledger_id === targetLedger.ledger_id) return { ...l, balance: newTargetBalance };
          return l;
        }),
      }));

      get().clearParserState();
      return { success: true, data: [srcEntry, tgtEntry] };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  updateParserInput(input, context) {
    set({ parserInput: input });
    get().parseTextInput({ input, ...context });
  },

  clearParserState() {
    set({ parserInput: '', parserPreview: null });
  },

  getEntriesForLedger(ledger_id) {
    return get().entries.filter((e) => e.ledger_id === ledger_id);
  },

  getEntriesForBook(book_id) {
    return get().entries.filter((e) => e.book_id === book_id);
  },

  getTransferPair(entry_id) {
    const entry = get().entries.find((e) => e.entry_id === entry_id);
    if (!entry?.transfer_group_id) return null;
    return (
      get().entries.find(
        (e) =>
          e.transfer_group_id === entry.transfer_group_id && e.entry_id !== entry_id,
      ) ?? null
    );
  },

  calculateLedgerBalance(ledger_id) {
    return get()
      .entries.filter((e) => e.ledger_id === ledger_id)
      .reduce((bal, e) => applyEntryToBalance(bal, e.amount, e.cat_direction), 0);
  },
}));
