import type { EntryDirection } from './domain.js';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PERMISSION_DENIED'
  | 'DATABASE_ERROR'
  | 'TRANSACTION_FAILED';

export type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string; code?: ErrorCode };

// Book actions
export interface CreateBookInput {
  name: string;
  is_balanced?: 0 | 1;
  is_auto_open?: 0 | 1;
}

export interface RenameBookInput {
  book_id: string;
  name: string;
}

export interface CloseBookInput {
  book_id: string;
}

// Ledger actions
export interface CreateLedgerInput {
  book_id: string;
  ledger_name: string;
  icon: string;
  ledger_color?: string | null;
  alias?: string | null;
}

export interface RenameLedgerInput {
  ledger_id: string;
  ledger_name: string;
}

export interface UpdateLedgerInput {
  ledger_id: string;
  icon?: string;
  ledger_color?: string | null;
  alias?: string | null;
}

// Entry actions
export interface CreateEntryInput {
  ledger_id: string;
  book_id: string;
  entry_date: string;
  detail?: string | null;
  amount: number;
  cat_direction: EntryDirection;
  transfer_group_id?: string | null;
}

export interface UpdateEntryInput {
  entry_id: string;
  entry_date?: string;
  detail?: string | null;
  amount?: number;
  cat_direction?: EntryDirection;
}

export interface DeleteEntryInput {
  entry_id: string;
  ledger_id: string;
}

// Navigation
export type ScreenName =
  | 'home'
  | 'book_list'
  | 'book_detail'
  | 'ledger_detail'
  | 'entry_form'
  | 'settings'
  | 'import'
  | 'export';

export interface NavigationState {
  screen: ScreenName;
  params?: Record<string, string>;
  history: ScreenName[];
}
