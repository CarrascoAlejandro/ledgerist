import type { Migration } from '../migrations.js';
import { INIT_SQL } from './init.js';

// The split-on-';' pipeline is safe here because 001 contains no trigger
// bodies; later migrations with BEGIN...END blocks must build their own
// statement lists (see 002_sync.ts).
export const migration001Init: Migration = {
  id: '001_init',
  async up(conn) {
    const statements = INIT_SQL
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    await conn.transaction(statements.map((sql) => ({ sql })));
  },
};
