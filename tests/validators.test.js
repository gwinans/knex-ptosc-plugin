import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKnexMock } from './helpers/knex-mock.js';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(() => Promise.resolve({ statistics: {} })),
}));

import { alterTableWithPtoscRaw } from '../src/index.js';
import { assertPositiveInteger, assertPositiveNumber } from '../src/validators.js';

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
