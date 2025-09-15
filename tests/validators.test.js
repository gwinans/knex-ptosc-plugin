import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKnexMock, createKnexMockBuilder } from './helpers/knex-mock.js';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(() => Promise.resolve({ statistics: {} })),
}));

import { alterTableWithPtoscRaw, alterTableWithPtosc } from '../src/index.js';
import { assertPositiveInteger, assertPositiveNumber } from '../src/validators.js';

describe('alterTableWithPtoscRaw option validation', () => {
  let knex;
  beforeEach(() => {
    knex = createKnexMock();
  });

  it('throws for invalid maxLoad', async () => {
    await expect(
      alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT', { maxLoad: 0 })
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('throws for invalid chunkSize', async () => {
    await expect(
      alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT', { chunkSize: 0 })
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('throws for invalid chunkSizeLimit', async () => {
    await expect(
      alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT', { chunkSizeLimit: 0 })
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('throws for invalid maxLag', async () => {
    await expect(
      alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT', { maxLag: 0 })
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('throws for invalid ptoscMinRows', async () => {
    await expect(
      alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT', { ptoscMinRows: -1 })
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe('alterTableWithPtosc option validation', () => {
  it('throws for invalid chunkSize', async () => {
    const knex = createKnexMockBuilder({
      toSQL: (name) => ({ sql: `ALTER TABLE ${name} ADD COLUMN foo INT` }),
    });
    await expect(
      alterTableWithPtosc(knex, 'widgets', () => {}, { chunkSize: 0 })
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('throws for invalid maxLag', async () => {
    const knex = createKnexMockBuilder({
      toSQL: (name) => ({ sql: `ALTER TABLE ${name} ADD COLUMN foo INT` }),
    });
    await expect(
      alterTableWithPtosc(knex, 'widgets', () => {}, { maxLag: 0 })
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
