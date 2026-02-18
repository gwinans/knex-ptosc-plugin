import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKnexMock, createKnexMockBuilder } from './helpers/knex-mock.js';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(() => Promise.resolve({ statistics: {} })),
}));

import { alterTableWithPtoscRaw, alterTableWithPtosc } from '../src/index.js';
import {
  assertBoolean,
  assertFunction,
  assertNonEmptyString,
  assertPositiveInteger,
  assertPositiveNumber,
  validatePtoscOptions,
} from '../src/validators.js';

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


  it('throws for invalid forcePtosc', async () => {
    await expect(
      alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT', { forcePtosc: 'yes' })
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('validates ptosc options even when INSTANT alters succeed', async () => {
    const rawImpl = vi.fn((sql) => {
      if (sql === 'SELECT VERSION() AS version') {
        return Promise.resolve([{ version: '8.0.34' }]);
      }
      if (/ALGORITHM=INSTANT/.test(sql)) {
        return Promise.resolve();
      }
      return Promise.resolve();
    });

    const knex = createKnexMock({ rawImpl });

    await expect(
      alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT', { chunkSize: 0 })
    ).rejects.toBeInstanceOf(TypeError);

    expect(rawImpl).not.toHaveBeenCalledWith(expect.stringMatching(/ALGORITHM=INSTANT/));
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

  it('assertBoolean throws on non-booleans', () => {
    expect(() => assertBoolean('test', 'true')).toThrow(TypeError);
  });

  it('assertNonEmptyString throws on empty strings', () => {
    expect(() => assertNonEmptyString('test', '')).toThrow(TypeError);
    expect(() => assertNonEmptyString('test', '   ')).toThrow(TypeError);
  });

  it('assertFunction throws on non-functions', () => {
    expect(() => assertFunction('test', 123)).toThrow(TypeError);
  });
});

describe('validatePtoscOptions', () => {
  it('applies defaults and validates', () => {
    const opts = validatePtoscOptions({});
    expect(opts.alterForeignKeysMethod).toBe('auto');
    expect(opts.chunkSize).toBe(1000);
    expect(opts.analyzeBeforeSwap).toBe(true);
  });

  it('throws for invalid alterForeignKeysMethod', () => {
    expect(() => validatePtoscOptions({ alterForeignKeysMethod: 'invalid' })).toThrow(TypeError);
  });

  it('throws for invalid logger shape', () => {
    expect(() => validatePtoscOptions({ logger: {} })).toThrow(/logger\.log/);
  });

  it('throws for invalid callback options', () => {
    expect(() => validatePtoscOptions({ onProgress: 'nope' })).toThrow(/onProgress/);
    expect(() => validatePtoscOptions({ onStatistics: 'nope' })).toThrow(/onStatistics/);
  });

  it('throws for invalid boolean options', () => {
    expect(() => validatePtoscOptions({ checkPlan: 'true' })).toThrow(/checkPlan/);
  });

  it('throws for invalid string options', () => {
    expect(() => validatePtoscOptions({ ptoscPath: '' })).toThrow(/ptoscPath/);
    expect(() => validatePtoscOptions({ maxLoadMetric: '' })).toThrow(/maxLoadMetric/);
  });
});
