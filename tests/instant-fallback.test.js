import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(() => Promise.resolve({ statistics: {} })),
}));

import { alterTableWithPtoscRaw } from '../src/index.js';
import { runPtoscProcess } from '../src/ptosc-runner.js';

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
    if (sql === 'SELECT VERSION() AS version') {
      return Promise.resolve([{ version: '8.0.0' }]);
    }
    if (/ALGORITHM=INSTANT/.test(sql)) {
      const err = new Error('unsupported');
      err.errno = 4092;
      return Promise.reject(err);
    }
    return Promise.resolve();
  });
  return knex;
}

describe('INSTANT fallback', () => {
  it('routes error 4092 through ptosc', async () => {
    const knex = createKnexMock();
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT');
    expect(knex.raw).toHaveBeenCalledWith(expect.stringMatching(/ALGORITHM=INSTANT/));
    expect(runPtoscProcess).toHaveBeenCalled();
  });
});

