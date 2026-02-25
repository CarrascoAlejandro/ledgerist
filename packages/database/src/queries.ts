import type { IDBConnection } from './connection.js';
import type { Book, Ledger, Entry, AppSettings, EntryDirection } from '@ledger/shared';

export function createQueries(db: IDBConnection) {
  return {
    // ── Books ──────────────────────────────────────────────────────────────

    async getBooks(): Promise<Book[]> {
      return db.query<Book>(
        'SELECT * FROM books WHERE status = 1 ORDER BY created_at DESC',
      );
    },

    async getBooksWithLedgerCount(): Promise<(Book & { ledger_count: number })[]> {
      return db.query<Book & { ledger_count: number }>(
        `SELECT b.*, COUNT(l.ledger_id) as ledger_count
         FROM books b
         LEFT JOIN ledgers l ON b.book_id = l.book_id AND l.status = 1
         WHERE b.status = 1
         GROUP BY b.book_id
         ORDER BY b.created_at DESC`,
      );
    },

    async getBookById(book_id: string): Promise<Book | null> {
      const rows = await db.query<Book>(
        'SELECT * FROM books WHERE book_id = ? AND status = 1',
        [book_id],
      );
      return rows[0] ?? null;
    },

    async insertBook(book_id: string, name: string): Promise<void> {
      await db.run(
        `INSERT INTO books (book_id, name, is_closed, is_balanced, is_auto_open, status)
         VALUES (?, ?, 0, 0, 0, 1)`,
        [book_id, name],
      );
    },

    async updateBookName(book_id: string, name: string): Promise<void> {
      await db.run(
        `UPDATE books SET name = ?, updated_at = datetime('now','utc') WHERE book_id = ?`,
        [name, book_id],
      );
    },

    async setBookClosed(book_id: string, is_closed: 0 | 1): Promise<void> {
      await db.run(
        `UPDATE books SET is_closed = ?, updated_at = datetime('now','utc') WHERE book_id = ?`,
        [is_closed, book_id],
      );
    },

    async setBookAutoOpen(book_id: string, is_auto_open: 0 | 1): Promise<void> {
      await db.run(
        `UPDATE books SET is_auto_open = ?, updated_at = datetime('now','utc') WHERE book_id = ?`,
        [is_auto_open, book_id],
      );
    },

    async setBookBalanced(book_id: string, is_balanced: 0 | 1): Promise<void> {
      await db.run(
        `UPDATE books SET is_balanced = ?, updated_at = datetime('now','utc') WHERE book_id = ?`,
        [is_balanced, book_id],
      );
    },

    async softDeleteBook(book_id: string): Promise<void> {
      await db.run(
        `UPDATE books SET status = 0, updated_at = datetime('now','utc') WHERE book_id = ?`,
        [book_id],
      );
    },

    // ── Ledgers ────────────────────────────────────────────────────────────

    async getLedgers(book_id: string): Promise<Ledger[]> {
      return db.query<Ledger>(
        'SELECT * FROM ledgers WHERE book_id = ? AND status = 1 ORDER BY created_at ASC',
        [book_id],
      );
    },

    async getLedgerById(ledger_id: string): Promise<Ledger | null> {
      const rows = await db.query<Ledger>(
        'SELECT * FROM ledgers WHERE ledger_id = ? AND status = 1',
        [ledger_id],
      );
      return rows[0] ?? null;
    },

    async getLedgerByAlias(book_id: string, alias: string): Promise<Ledger | null> {
      const rows = await db.query<Ledger>(
        'SELECT * FROM ledgers WHERE book_id = ? AND alias = ? AND status = 1',
        [book_id, alias],
      );
      return rows[0] ?? null;
    },

    async insertLedger(
      ledger_id: string,
      book_id: string,
      ledger_name: string,
      icon: string,
    ): Promise<void> {
      await db.run(
        `INSERT INTO ledgers (ledger_id, book_id, ledger_name, icon, balance, status)
         VALUES (?, ?, ?, ?, 0, 1)`,
        [ledger_id, book_id, ledger_name, icon],
      );
    },

    async updateLedgerName(ledger_id: string, name: string): Promise<void> {
      await db.run(
        `UPDATE ledgers SET ledger_name = ?, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
        [name, ledger_id],
      );
    },

    async updateLedgerBalance(ledger_id: string, balance: number): Promise<void> {
      await db.run(
        `UPDATE ledgers SET balance = ?, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
        [balance, ledger_id],
      );
    },

    async updateLedgerColor(ledger_id: string, color: string | null): Promise<void> {
      await db.run(
        `UPDATE ledgers SET ledger_color = ?, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
        [color, ledger_id],
      );
    },

    async updateLedgerIcon(ledger_id: string, icon: string): Promise<void> {
      await db.run(
        `UPDATE ledgers SET icon = ?, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
        [icon, ledger_id],
      );
    },

    async updateLedgerAlias(ledger_id: string, alias: string | null): Promise<void> {
      await db.run(
        `UPDATE ledgers SET alias = ?, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
        [alias, ledger_id],
      );
    },

    async softDeleteLedger(ledger_id: string): Promise<void> {
      await db.run(
        `UPDATE ledgers SET status = 0, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
        [ledger_id],
      );
    },

    async softDeleteLedgersByBook(book_id: string): Promise<void> {
      await db.run(
        `UPDATE ledgers SET status = 0, updated_at = datetime('now','utc') WHERE book_id = ?`,
        [book_id],
      );
    },

    // ── Entries ────────────────────────────────────────────────────────────

    async getEntriesByLedger(ledger_id: string): Promise<Entry[]> {
      return db.query<Entry>(
        'SELECT * FROM entries WHERE ledger_id = ? AND status = 1 ORDER BY entry_date DESC, created_at DESC',
        [ledger_id],
      );
    },

    async getEntriesByBook(book_id: string): Promise<Entry[]> {
      return db.query<Entry>(
        'SELECT * FROM entries WHERE book_id = ? AND status = 1 ORDER BY entry_date DESC, created_at DESC',
        [book_id],
      );
    },

    async getEntryById(entry_id: string): Promise<Entry | null> {
      const rows = await db.query<Entry>(
        'SELECT * FROM entries WHERE entry_id = ? AND status = 1',
        [entry_id],
      );
      return rows[0] ?? null;
    },

    async getTransferGroup(transfer_group_id: string): Promise<Entry[]> {
      return db.query<Entry>(
        'SELECT * FROM entries WHERE transfer_group_id = ? AND status = 1',
        [transfer_group_id],
      );
    },

    async getEntriesForExport(
      book_id: string,
    ): Promise<(Entry & { ledger_name: string; book_name: string })[]> {
      return db.query<Entry & { ledger_name: string; book_name: string }>(
        `SELECT e.*, l.ledger_name, b.name as book_name
         FROM entries e
         JOIN ledgers l ON e.ledger_id = l.ledger_id
         JOIN books b ON e.book_id = b.book_id
         WHERE e.book_id = ? AND e.status = 1
         ORDER BY e.entry_date DESC, e.created_at DESC`,
        [book_id],
      );
    },

    async insertEntry(
      entry_id: string,
      data: {
        ledger_id: string;
        book_id: string;
        entry_date: string;
        detail: string | null;
        amount: number;
        cat_direction: EntryDirection;
        transfer_group_id: string | null;
      },
    ): Promise<void> {
      await db.run(
        `INSERT INTO entries
           (entry_id, ledger_id, book_id, entry_date, detail, amount, cat_direction, transfer_group_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          entry_id,
          data.ledger_id,
          data.book_id,
          data.entry_date,
          data.detail,
          data.amount,
          data.cat_direction,
          data.transfer_group_id,
        ],
      );
    },

    async updateEntryFields(
      entry_id: string,
      fields: {
        entry_date?: string;
        detail?: string | null;
        amount?: number;
        cat_direction?: EntryDirection;
      },
    ): Promise<void> {
      const parts: string[] = [];
      const params: unknown[] = [];
      if (fields.entry_date !== undefined) {
        parts.push('entry_date = ?');
        params.push(fields.entry_date);
      }
      if (fields.detail !== undefined) {
        parts.push('detail = ?');
        params.push(fields.detail);
      }
      if (fields.amount !== undefined) {
        parts.push('amount = ?');
        params.push(fields.amount);
      }
      if (fields.cat_direction !== undefined) {
        parts.push('cat_direction = ?');
        params.push(fields.cat_direction);
      }
      if (parts.length === 0) return;
      parts.push("updated_at = datetime('now','utc')");
      params.push(entry_id);
      await db.run(`UPDATE entries SET ${parts.join(', ')} WHERE entry_id = ?`, params);
    },

    async softDeleteEntry(entry_id: string): Promise<void> {
      await db.run(
        `UPDATE entries SET status = 0, updated_at = datetime('now','utc') WHERE entry_id = ?`,
        [entry_id],
      );
    },

    async softDeleteEntriesByLedger(ledger_id: string): Promise<void> {
      await db.run(
        `UPDATE entries SET status = 0, updated_at = datetime('now','utc') WHERE ledger_id = ?`,
        [ledger_id],
      );
    },

    async softDeleteEntriesByBook(book_id: string): Promise<void> {
      await db.run(
        `UPDATE entries SET status = 0, updated_at = datetime('now','utc') WHERE book_id = ?`,
        [book_id],
      );
    },

    // ── Settings ───────────────────────────────────────────────────────────

    async getSettings(): Promise<AppSettings | null> {
      const rows = await db.query<AppSettings>(
        'SELECT * FROM app_settings WHERE status = 1 LIMIT 1',
      );
      return rows[0] ?? null;
    },

    async insertSettings(app_settings_id: string): Promise<void> {
      await db.run(
        `INSERT INTO app_settings
           (app_settings_id, dark_mode, week_start_day, weekend_start_day, cat_default_entry_direction, status)
         VALUES (?, 0, 0, 5, 'sub', 1)`,
        [app_settings_id],
      );
    },

    async updateSettingsDarkMode(dark_mode: 0 | 1): Promise<void> {
      await db.run(
        `UPDATE app_settings SET dark_mode = ?, updated_at = datetime('now','utc')`,
        [dark_mode],
      );
    },

    async updateSettingsWeekStart(day: number): Promise<void> {
      await db.run(
        `UPDATE app_settings SET week_start_day = ?, updated_at = datetime('now','utc')`,
        [day],
      );
    },

    async updateSettingsWeekendStart(day: number): Promise<void> {
      await db.run(
        `UPDATE app_settings SET weekend_start_day = ?, updated_at = datetime('now','utc')`,
        [day],
      );
    },

    async updateSettingsDefaultDirection(direction: EntryDirection): Promise<void> {
      await db.run(
        `UPDATE app_settings SET cat_default_entry_direction = ?, updated_at = datetime('now','utc')`,
        [direction],
      );
    },
  };
}

export type Queries = ReturnType<typeof createQueries>;
