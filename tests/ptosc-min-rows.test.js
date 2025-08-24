import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(() => Promise.resolve({ statistics: {} })),
}));

import { alterTableWithPtoscRaw } from '../src/index.js';
import { runPtoscProcess } from '../src/ptosc-runner.js';

beforeEach(() => {
  vi.clearAllMocks();
});

function createKnexMock() {
  const knex = () => ({
    where() { return this; },
    update: async () => 1,
    select() { return this; },
    first: async () => ({ is_locked: 0 }),
  });
  knex.schema = { hasTable: async () => true };
  knex.client = { config: { connection: { database: 'testdb', host: 'localhost', user: 'root' } } };
  knex.raw = vi.fn((sql) => {
    if (sql.startsWith('SELECT TABLE_ROWS FROM information_schema.tables')) {
      return Promise.resolve([{ TABLE_ROWS: 5 }]);
    }
    return Promise.resolve();
  });
  return knex;
}

describe('ptoscMinRows fast path', () => {
  it('runs native ALTER when row count below threshold', async () => {
    const knex = createKnexMock();
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT', { ptoscMinRows: 10 });
    expect(knex.raw).toHaveBeenCalledWith(
      'SELECT TABLE_ROWS FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      ['testdb', 'widgets']
    );
    expect(knex.raw).toHaveBeenLastCalledWith('ALTER TABLE widgets ADD COLUMN foo INT');
    expect(runPtoscProcess).not.toHaveBeenCalled();
  });
});
