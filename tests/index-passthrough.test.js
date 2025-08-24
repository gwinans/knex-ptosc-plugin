import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(() => Promise.resolve({ statistics: {} })),
}));

import { alterTableWithPtoscRaw, alterTableWithPtosc } from '../src/index.js';
import { runPtoscProcess } from '../src/ptosc-runner.js';

beforeEach(() => {
  vi.clearAllMocks();
});

function createKnexMockRaw() {
  const knex = () => ({
    where() { return this; },
    update: async () => 1,
    select() { return this; },
    first: async () => ({ is_locked: 0 }),
  });
  knex.schema = { hasTable: async () => true };
  knex.raw = vi.fn(() => Promise.resolve());
  return knex;
}

function createKnexMockBuilder() {
  const knex = createKnexMockRaw();
  knex.client = { config: { connection: { database: 'testdb', host: 'localhost', user: 'root' } } };
  knex.schema.alterTable = (name, cb) => {
    cb({});
    return {
      toSQL: () => ({ sql: `ALTER TABLE ${name} ADD INDEX idx_foo (foo)` }),
    };
  };
  knex.raw = vi.fn((sql, bindings) => {
    if (bindings !== undefined) {
      return { toQuery: () => sql };
    }
    return Promise.resolve();
  });
  return knex;
}

describe('index clause passthrough', () => {
  it('runs ADD INDEX via alterTableWithPtoscRaw', async () => {
    const knex = createKnexMockRaw();
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD INDEX idx_foo (foo)');
    expect(knex.raw).toHaveBeenCalledWith('ALTER TABLE widgets ADD INDEX idx_foo (foo)');
    expect(runPtoscProcess).not.toHaveBeenCalled();
  });

  it('runs DROP INDEX via alterTableWithPtoscRaw', async () => {
    const knex = createKnexMockRaw();
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets DROP INDEX idx_foo');
    expect(knex.raw).toHaveBeenCalledWith('ALTER TABLE widgets DROP INDEX idx_foo');
    expect(runPtoscProcess).not.toHaveBeenCalled();
  });

  it('runs ADD INDEX via alterTableWithPtosc', async () => {
    const knex = createKnexMockBuilder();
    await alterTableWithPtosc(knex, 'widgets', () => {});
    expect(knex.raw).toHaveBeenLastCalledWith('ALTER TABLE widgets ADD INDEX idx_foo (foo)');
    expect(runPtoscProcess).not.toHaveBeenCalled();
  });
});
