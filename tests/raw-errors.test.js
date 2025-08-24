import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(() => Promise.resolve({ statistics: {} })),
}));

import { alterTableWithPtoscRaw, alterTableWithPtosc } from '../src/index.js';

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

function createKnexMockBuilderNoAlter() {
  const knex = createKnexMockRaw();
  knex.schema.alterTable = (name, cb) => {
    cb({});
    return {
      toSQL: () => ({ sql: `CREATE TABLE ${name} (id int)` }),
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

describe('input validation', () => {
  it('throws when no SQL statements are provided to alterTableWithPtoscRaw', async () => {
    const knex = createKnexMockRaw();
    await expect(alterTableWithPtoscRaw(knex)).rejects.toThrow('No SQL statements provided.');
  });

  it('throws when a non-ALTER statement is provided to alterTableWithPtoscRaw', async () => {
    const knex = createKnexMockRaw();
    await expect(alterTableWithPtoscRaw(knex, 'DROP TABLE widgets')).rejects.toThrow(
      'Only ALTER TABLE statements are supported: DROP TABLE widgets'
    );
  });

  it('throws when alterTableWithPtosc produces no ALTER clauses', async () => {
    const knex = createKnexMockBuilderNoAlter();
    await expect(
      alterTableWithPtosc(knex, 'widgets', () => {})
    ).rejects.toThrow(/No ALTER TABLE statements generated/);
  });
});
