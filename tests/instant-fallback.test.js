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

function createKnexMock({ version = '8.0.0', instantError } = {}) {
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
      return Promise.resolve([{ version }]);
    }
    if (/ALGORITHM=INSTANT/.test(sql)) {
      if (instantError) return Promise.reject(instantError);
      return Promise.resolve();
    }
    return Promise.resolve();
  });
  return knex;
}

describe('INSTANT fallback', () => {
  it('routes error 4092 through ptosc', async () => {
    const err = new Error('unsupported');
    err.errno = 4092;
    const knex = createKnexMock({ instantError: err });
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT');
    expect(knex.raw).toHaveBeenCalledWith(expect.stringMatching(/ALGORITHM=INSTANT/));
    expect(runPtoscProcess).toHaveBeenCalled();
  });

  it('routes unsupported INSTANT message through ptosc', async () => {
    const err = new Error('ALGORITHM=INSTANT is not supported');
    const knex = createKnexMock({ instantError: err });
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT');
    expect(knex.raw).toHaveBeenCalledWith(expect.stringMatching(/ALGORITHM=INSTANT/));
    expect(runPtoscProcess).toHaveBeenCalled();
  });

  it('skips INSTANT on MySQL 5.7', async () => {
    const knex = createKnexMock({ version: '5.7.34' });
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT');
    expect(knex.raw).toHaveBeenCalledWith('SELECT VERSION() AS version');
    expect(knex.raw).not.toHaveBeenCalledWith(expect.stringMatching(/ALGORITHM=INSTANT/));
    expect(runPtoscProcess).toHaveBeenCalled();
  });
});

