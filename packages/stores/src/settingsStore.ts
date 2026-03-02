import { create } from 'zustand';
import { createQueries } from '@ledger/database';
import type { AppSettings, ActionResult, EntryDirection } from '@ledger/shared';
import { getDB } from './db.js';
import { useBookStore } from './bookStore.js';

interface SettingsState {
  settings: AppSettings | null;
  loading: boolean;
  error: string | null;
}

interface SettingsActions {
  loadSettings(): Promise<ActionResult<AppSettings>>;
  toggleDarkMode(enabled: boolean): Promise<ActionResult>;
  setWeekStartDay(day: 0 | 1 | 2 | 3 | 4 | 5 | 6): Promise<ActionResult>;
  setWeekendStartDay(day: 0 | 1 | 2 | 3 | 4 | 5 | 6): Promise<ActionResult>;
  exportToCSV(): Promise<ActionResult<string>>;

  // Getters
  isDarkModeEnabled(): boolean;
  getDefaultEntryDirection(): EntryDirection;
  getWeekStartDay(): number;
  getWeekendStartDay(): number;
}

export const useSettingsStore = create<SettingsState & SettingsActions>((set, get) => ({
  settings: null,
  loading: false,
  error: null,

  async loadSettings() {
    set({ loading: true, error: null });
    try {
      const q = createQueries(getDB());
      let settings = await q.getSettings();

      if (!settings) {
        const id = crypto.randomUUID();
        await q.insertSettings(id);
        settings = await q.getSettings();
      }

      if (!settings) {
        set({ loading: false, error: 'Failed to load settings' });
        return { success: false, error: 'Failed to load settings', code: 'DATABASE_ERROR' };
      }

      // Apply dark mode to DOM (guard for non-browser environments like tests)
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', settings.dark_mode === 1);
      }

      set({ settings, loading: false });
      return { success: true, data: settings };
    } catch (e) {
      set({ loading: false, error: String(e) });
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async toggleDarkMode(enabled) {
    try {
      const q = createQueries(getDB());
      await q.updateSettingsDarkMode(enabled ? 1 : 0);
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', enabled);
      }
      set((state) =>
        state.settings
          ? { settings: { ...state.settings, dark_mode: enabled ? 1 : 0 } }
          : {},
      );
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async setWeekStartDay(day) {
    try {
      const q = createQueries(getDB());
      await q.updateSettingsWeekStart(day);
      set((state) =>
        state.settings ? { settings: { ...state.settings, week_start_day: day } } : {},
      );
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async setWeekendStartDay(day) {
    try {
      const q = createQueries(getDB());
      await q.updateSettingsWeekendStart(day);
      set((state) =>
        state.settings ? { settings: { ...state.settings, weekend_start_day: day } } : {},
      );
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  async exportToCSV() {
    try {
      const q = createQueries(getDB());
      const books = useBookStore.getState().books;
      const allRows: Array<{
        book_name: string;
        ledger_name: string;
        entry_date: string;
        detail: string | null;
        amount: number;
        cat_direction: string;
      }> = [];

      for (const book of books) {
        const rows = await q.getEntriesForExport(book.book_id);
        allRows.push(...rows);
      }

      const header = 'book,ledger,date,detail,amount,direction';
      const lines = allRows.map((r) => {
        const book = `"${r.book_name.replace(/"/g, '""')}"`;
        const ledger = `"${r.ledger_name.replace(/"/g, '""')}"`;
        const detail = r.detail ? `"${r.detail.replace(/"/g, '""')}"` : '';
        return `${book},${ledger},${r.entry_date},${detail},${r.amount},${r.cat_direction}`;
      });

      const csv = [header, ...lines].join('\n');
      return { success: true, data: csv };
    } catch (e) {
      return { success: false, error: String(e), code: 'DATABASE_ERROR' };
    }
  },

  isDarkModeEnabled() {
    return get().settings?.dark_mode === 1;
  },

  getDefaultEntryDirection() {
    return get().settings?.cat_default_entry_direction ?? 'sub';
  },

  getWeekStartDay() {
    return get().settings?.week_start_day ?? 1;
  },

  getWeekendStartDay() {
    return get().settings?.weekend_start_day ?? 6;
  },
}));
