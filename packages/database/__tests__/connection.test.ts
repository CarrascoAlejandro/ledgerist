import type { IDBConnection } from '../src/connection.js';

// In-memory TestDBConnection double — implements IDBConnection without sql.js
class TestDBConnection implements IDBConnection {
  private store = new Map<string, unknown[]>();
  private open = true;
  private lastID = 0;
  private changes = 0;

  async query<T>(sql: string, _params?: unknown[]): Promise<T[]> {
    const key = sql.trim();
    const rows = this.store.get(key) ?? [];
    return rows as T[];
  }

  async run(
    sql: string,
    _params?: unknown[],
  ): Promise<{ lastID?: number; changes?: number }> {
    this.lastID += 1;
    this.changes = 1;
    // Simulate simple INSERT by storing a marker
    const key = sql.trim();
    this.store.set(key, [{ affected: true }]);
    return { lastID: this.lastID, changes: this.changes };
  }

  async transaction(ops: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    for (const op of ops) {
      await this.run(op.sql, op.params);
    }
  }

  isOpen(): boolean {
    return this.open;
  }

  async close(): Promise<void> {
    this.open = false;
  }
}

describe('IDBConnection interface compliance (TestDBConnection)', () => {
  let conn: IDBConnection;

  beforeEach(() => {
    conn = new TestDBConnection();
  });

  it('isOpen() returns true after initialization', () => {
    expect(conn.isOpen()).toBe(true);
  });

  it('isOpen() returns false after close()', async () => {
    await conn.close();
    expect(conn.isOpen()).toBe(false);
  });

  it('query() returns an array', async () => {
    const results = await conn.query('SELECT * FROM books');
    expect(Array.isArray(results)).toBe(true);
  });

  it('run() returns an object with lastID and changes', async () => {
    const result = await conn.run('INSERT INTO books VALUES (?)', ['id-1']);
    expect(result).toHaveProperty('lastID');
    expect(result).toHaveProperty('changes');
    expect(typeof result.lastID).toBe('number');
    expect(typeof result.changes).toBe('number');
  });

  it('transaction() resolves without throwing', async () => {
    await expect(
      conn.transaction([
        { sql: 'INSERT INTO books VALUES (?)', params: ['id-1'] },
        { sql: 'INSERT INTO books VALUES (?)', params: ['id-2'] },
      ]),
    ).resolves.toBeUndefined();
  });

  it('lastID increments on successive run() calls', async () => {
    const r1 = await conn.run('INSERT INTO a VALUES (1)');
    const r2 = await conn.run('INSERT INTO b VALUES (2)');
    expect(r2.lastID!).toBeGreaterThan(r1.lastID!);
  });
});
