export interface Book {
  book_id: string;
  name: string;
  is_closed: 0 | 1;
  is_balanced: 0 | 1;
  is_auto_open: 0 | 1;
  status: 0 | 1;
  created_at: string;
  updated_at: string | null;
  version_hlc?: string | null;
  origin_device_id?: string | null;
}

export type NewBook = Omit<Book, 'book_id' | 'created_at' | 'updated_at'>;

export interface Ledger {
  ledger_id: string;
  book_id: string;
  ledger_name: string;
  icon: string;
  ledger_color: string | null;
  alias: string | null;
  balance: number;
  status: 0 | 1;
  created_at: string;
  updated_at: string | null;
  version_hlc?: string | null;
  origin_device_id?: string | null;
}

export type NewLedger = Omit<Ledger, 'ledger_id' | 'balance' | 'created_at' | 'updated_at'>;

export type EntryDirection = 'add' | 'sub';

export interface Entry {
  entry_id: string;
  ledger_id: string;
  book_id: string;
  entry_date: string;
  detail: string | null;
  amount: number;
  cat_direction: EntryDirection;
  transfer_group_id: string | null;
  status: 0 | 1;
  created_at: string;
  updated_at: string | null;
  version_hlc?: string | null;
  origin_device_id?: string | null;
}

export type NewEntry = Omit<Entry, 'entry_id' | 'created_at' | 'updated_at'>;

export interface AppSettings {
  app_settings_id: string;
  dark_mode: 0 | 1;
  week_start_day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  weekend_start_day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  cat_default_entry_direction: EntryDirection;
  status: 0 | 1;
  created_at: string;
  updated_at: string | null;
}

export interface ParserPreview {
  raw: string;
  parsed_date: string | null;
  parsed_amount: number | null;
  parsed_direction: EntryDirection | null;
  parsed_detail: string | null;
  errors: string[];
  warnings: string[];
  is_transfer: boolean;
  transfer_target: string | null;
}
