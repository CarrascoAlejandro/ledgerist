/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import { WebDBConnection, runMigrations } from '@ledger/database';
import type { IDBConnection } from '@ledger/database';
import { useSettingsStore, setDB } from '../src/index.js';

async function createTestDB(): Promise<IDBConnection> {
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
  useSettingsStore.setState({ settings: null, loading: false, error: null });
  // Load settings to initialize default row
  await useSettingsStore.getState().loadSettings();
});

afterEach(async () => {
  await conn.close();
});

describe('setWeekStartDay', () => {
  it('updates week_start_day in state', async () => {
    const result = await useSettingsStore.getState().setWeekStartDay(0);
    expect(result.success).toBe(true);
    expect(useSettingsStore.getState().settings?.week_start_day).toBe(0);
  });

  it('persists across state after successive calls', async () => {
    await useSettingsStore.getState().setWeekStartDay(3);
    expect(useSettingsStore.getState().settings?.week_start_day).toBe(3);

    await useSettingsStore.getState().setWeekStartDay(6);
    expect(useSettingsStore.getState().settings?.week_start_day).toBe(6);
  });

  it('getWeekStartDay getter reflects updated value', async () => {
    await useSettingsStore.getState().setWeekStartDay(5);
    expect(useSettingsStore.getState().getWeekStartDay()).toBe(5);
  });
});

describe('setWeekendStartDay', () => {
  it('updates weekend_start_day in state', async () => {
    const result = await useSettingsStore.getState().setWeekendStartDay(5);
    expect(result.success).toBe(true);
    expect(useSettingsStore.getState().settings?.weekend_start_day).toBe(5);
  });

  it('getWeekendStartDay getter reflects updated value', async () => {
    await useSettingsStore.getState().setWeekendStartDay(6);
    expect(useSettingsStore.getState().getWeekendStartDay()).toBe(6);
  });
});

describe('exportToCSV', () => {
  it('returns success with CSV string when no books exist', async () => {
    const result = await useSettingsStore.getState().exportToCSV();
    expect(result.success).toBe(true);
    if (result.success) {
      // Header only when no entries
      expect(result.data).toContain('book,ledger,date,detail,amount,direction');
    }
  });

  it('CSV includes header row', async () => {
    const result = await useSettingsStore.getState().exportToCSV();
    expect(result.success).toBe(true);
    if (result.success) {
      const lines = result.data!.split('\n');
      expect(lines[0]).toBe('book,ledger,date,detail,amount,direction');
    }
  });
});
