export const INIT_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS \`books\` (
  \`book_id\` TEXT PRIMARY KEY,
  \`name\` TEXT UNIQUE NOT NULL,
  \`is_closed\` INTEGER DEFAULT 0 CHECK (\`is_closed\` IN (0, 1)),
  \`is_balanced\` INTEGER DEFAULT 0 CHECK (\`is_balanced\` IN (0, 1)),
  \`is_auto_open\` INTEGER DEFAULT 0 CHECK (\`is_auto_open\` IN (0, 1)),
  \`status\` INTEGER DEFAULT 1 CHECK (\`status\` IN (0, 1)),
  \`created_at\` TEXT DEFAULT (datetime('now', 'utc')),
  \`updated_at\` TEXT
);

CREATE TABLE IF NOT EXISTS \`ledgers\` (
  \`ledger_id\` TEXT PRIMARY KEY,
  \`book_id\` TEXT NOT NULL,
  \`ledger_name\` TEXT NOT NULL,
  \`icon\` TEXT NOT NULL,
  \`ledger_color\` TEXT,
  \`alias\` TEXT,
  \`balance\` NUMERIC DEFAULT 0,
  \`status\` INTEGER DEFAULT 1 CHECK (\`status\` IN (0, 1)),
  \`created_at\` TEXT DEFAULT (datetime('now', 'utc')),
  \`updated_at\` TEXT,
  FOREIGN KEY (\`book_id\`) REFERENCES \`books\` (\`book_id\`)
);

CREATE TABLE IF NOT EXISTS \`entries\` (
  \`entry_id\` TEXT PRIMARY KEY,
  \`ledger_id\` TEXT NOT NULL,
  \`book_id\` TEXT NOT NULL,
  \`entry_date\` TEXT NOT NULL,
  \`detail\` TEXT,
  \`amount\` NUMERIC NOT NULL,
  \`cat_direction\` TEXT NOT NULL DEFAULT 'sub' CHECK (\`cat_direction\` IN ('add', 'sub')),
  \`transfer_group_id\` TEXT,
  \`status\` INTEGER DEFAULT 1 CHECK (\`status\` IN (0, 1)),
  \`created_at\` TEXT DEFAULT (datetime('now', 'utc')),
  \`updated_at\` TEXT,
  FOREIGN KEY (\`ledger_id\`) REFERENCES \`ledgers\` (\`ledger_id\`),
  FOREIGN KEY (\`book_id\`) REFERENCES \`books\` (\`book_id\`)
);

CREATE TABLE IF NOT EXISTS \`app_settings\` (
  \`app_settings_id\` TEXT PRIMARY KEY,
  \`dark_mode\` INTEGER DEFAULT 0 CHECK (\`dark_mode\` IN (0, 1)),
  \`week_start_day\` INTEGER DEFAULT 0 CHECK (\`week_start_day\` BETWEEN 0 AND 6),
  \`weekend_start_day\` INTEGER DEFAULT 5 CHECK (\`weekend_start_day\` BETWEEN 0 AND 6),
  \`cat_default_entry_direction\` TEXT DEFAULT 'sub' CHECK (\`cat_default_entry_direction\` IN ('add', 'sub')),
  \`status\` INTEGER DEFAULT 1 CHECK (\`status\` IN (0, 1)),
  \`created_at\` TEXT DEFAULT (datetime('now', 'utc')),
  \`updated_at\` TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS \`ledgers_index_0\` ON \`ledgers\` (\`book_id\`, \`alias\`);

CREATE INDEX IF NOT EXISTS \`entries_index_1\` ON \`entries\` (\`book_id\`);

CREATE INDEX IF NOT EXISTS \`entries_index_2\` ON \`entries\` (\`ledger_id\`);

CREATE INDEX IF NOT EXISTS \`entries_index_3\` ON \`entries\` (\`entry_date\`);

CREATE INDEX IF NOT EXISTS \`entries_index_4\` ON \`entries\` (\`transfer_group_id\`);
`;
