import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(() => Promise.resolve({ statistics: {} })),
}));

import { alterTableWithPtoscRaw } from '../src/index.js';
import { assertPositiveInteger, assertPositiveNumber } from '../src/validators.js';

function createKnexMock() {
  const knex = () => ({
    where() { return this; },
    update: async () => 1,
    select() { return this; },
    first: async () => ({ is_locked: 0 }),
  });
  knex.schema = { hasTable: async () => true };
  knex.client = { config: { connection: { database: 'testdb', host: 'localhost', user: 'root' } } };
  knex.raw = vi.fn(() => Promise.resolve());
  return knex;
}

describe('option validation', () => {
  let knex;
  beforeEach(() => {
    knex = createKnexMock();
  });

  it('throws for invalid maxLoad', async () => {
    await expect(
      alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT', { maxLoad: 0 })
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('throws for invalid chunkSizeLimit', async () => {
    await expect(
      alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT', { chunkSizeLimit: 0 })
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('throws for invalid ptoscMinRows', async () => {
    await expect(
      alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT', { ptoscMinRows: -1 })
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe('assert helpers', () => {
  it('assertPositiveInteger throws on invalid values', () => {
    expect(() => assertPositiveInteger('test', 0)).toThrow(TypeError);
    expect(() => assertPositiveInteger('test', -1)).toThrow(TypeError);
    expect(() => assertPositiveInteger('test', 1.2)).toThrow(TypeError);
  });

  it('assertPositiveNumber throws on invalid values', () => {
    expect(() => assertPositiveNumber('test', 0)).toThrow(TypeError);
    expect(() => assertPositiveNumber('test', -1.2)).toThrow(TypeError);
    expect(() => assertPositiveNumber('test', 'foo')).toThrow(TypeError);
  });
});
