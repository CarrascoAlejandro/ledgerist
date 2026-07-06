import {
  CapacitorDBConnection,
  type CapacitorSQLiteDB,
  type CapacitorSQLiteManager,
} from '../src/drivers/capacitor.js';

// Hand-rolled fakes recording calls — dependency injection, no module mocking
// (the plugin itself is never loaded in tests).
interface RecordedRun {
  statement: string;
  values: unknown[] | undefined;
  transaction: boolean | undefined;
}

class FakeCapacitorDB implements CapacitorSQLiteDB {
  queryCalls: Array<{ statement: string; values: unknown[] | undefined }> = [];
  runCalls: RecordedRun[] = [];
  executeSetCalls: Array<{
    set: Array<{ statement: string; values: unknown[] }>;
    transaction: boolean | undefined;
  }> = [];
  closeCalls = 0;

  queryResult: { values?: unknown[] } = { values: [] };
  runResult: { changes?: { changes?: number; lastId?: number } } = {};

  async query(statement: string, values?: unknown[]) {
    this.queryCalls.push({ statement, values });
    return this.queryResult;
  }

  async run(statement: string, values?: unknown[], transaction?: boolean) {
    this.runCalls.push({ statement, values, transaction });
    return this.runResult;
  }

  async executeSet(
    set: Array<{ statement: string; values: unknown[] }>,
    transaction?: boolean,
  ) {
    this.executeSetCalls.push({ set, transaction });
    return {};
  }

  async execute(_statements: string, _transaction?: boolean) {
    return {};
  }

  async close() {
    this.closeCalls += 1;
    return {};
  }
}

class FakeManager implements CapacitorSQLiteManager {
  closeConnectionCalls: Array<{ database: string; readonly: boolean }> = [];

  async closeConnection(database: string, readonly: boolean) {
    this.closeConnectionCalls.push({ database, readonly });
    return {};
  }
}

describe('CapacitorDBConnection', () => {
  let fakeDB: FakeCapacitorDB;
  let manager: FakeManager;
  let conn: CapacitorDBConnection;

  beforeEach(() => {
    fakeDB = new FakeCapacitorDB();
    manager = new FakeManager();
    conn = new CapacitorDBConnection(fakeDB, 'ledger', manager);
  });

  describe('query()', () => {
    it('unwraps { values } into a plain array', async () => {
      const rows = [{ book_id: 'b1' }, { book_id: 'b2' }];
      fakeDB.queryResult = { values: rows };
      const result = await conn.query('SELECT * FROM books', []);
      expect(result).toEqual(rows);
    });

    it('maps a missing values field to an empty array', async () => {
      fakeDB.queryResult = {};
      const result = await conn.query('SELECT * FROM books');
      expect(result).toEqual([]);
    });

    it('passes sql and params through to the plugin', async () => {
      await conn.query('SELECT * FROM books WHERE book_id = ?', ['b1']);
      expect(fakeDB.queryCalls).toEqual([
        { statement: 'SELECT * FROM books WHERE book_id = ?', values: ['b1'] },
      ]);
    });
  });

  describe('run()', () => {
    it('maps lastId/changes to lastID/changes', async () => {
      fakeDB.runResult = { changes: { changes: 1, lastId: 42 } };
      const result = await conn.run('INSERT INTO books VALUES (?)', ['b1']);
      expect(result).toEqual({ lastID: 42, changes: 1 });
    });

    it('returns undefined fields when the plugin omits changes', async () => {
      fakeDB.runResult = {};
      const result = await conn.run('UPDATE books SET name = ?', ['x']);
      expect(result).toEqual({ lastID: undefined, changes: undefined });
    });

    it('passes transaction: false (autocommit)', async () => {
      await conn.run('INSERT INTO books VALUES (?)', ['b1']);
      expect(fakeDB.runCalls).toEqual([
        { statement: 'INSERT INTO books VALUES (?)', values: ['b1'], transaction: false },
      ]);
    });
  });

  describe('transaction()', () => {
    it('maps ops to { statement, values } with transaction: true', async () => {
      await conn.transaction([
        { sql: 'INSERT INTO books VALUES (?)', params: ['b1'] },
        { sql: 'UPDATE books SET name = ? WHERE book_id = ?', params: ['x', 'b1'] },
      ]);
      expect(fakeDB.executeSetCalls).toEqual([
        {
          set: [
            { statement: 'INSERT INTO books VALUES (?)', values: ['b1'] },
            { statement: 'UPDATE books SET name = ? WHERE book_id = ?', values: ['x', 'b1'] },
          ],
          transaction: true,
        },
      ]);
    });

    it('defaults missing params to an empty values array', async () => {
      await conn.transaction([{ sql: 'DELETE FROM books' }]);
      expect(fakeDB.executeSetCalls[0].set).toEqual([
        { statement: 'DELETE FROM books', values: [] },
      ]);
    });

    it('propagates plugin failures (native rollback)', async () => {
      fakeDB.executeSet = async () => {
        throw new Error('executeSet failed');
      };
      await expect(conn.transaction([{ sql: 'INSERT INTO books VALUES (1)' }])).rejects.toThrow(
        'executeSet failed',
      );
    });
  });

  describe('isOpen() / close()', () => {
    it('isOpen() returns true after construction', () => {
      expect(conn.isOpen()).toBe(true);
    });

    it('close() closes the db, releases the managed connection, and flips isOpen()', async () => {
      await conn.close();
      expect(fakeDB.closeCalls).toBe(1);
      expect(manager.closeConnectionCalls).toEqual([{ database: 'ledger', readonly: false }]);
      expect(conn.isOpen()).toBe(false);
    });

    it('double close() is a no-op', async () => {
      await conn.close();
      await conn.close();
      expect(fakeDB.closeCalls).toBe(1);
      expect(manager.closeConnectionCalls).toHaveLength(1);
    });
  });
});
