import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKnexMock } from './helpers/knex-mock.js';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(() => Promise.resolve({ statistics: {} })),
}));

import { alterTableWithPtoscRaw } from '../src/index.js';
import { runPtoscProcess } from '../src/ptosc-runner.js';

beforeEach(() => {
  vi.clearAllMocks();
});


describe('INSTANT fallback', () => {
  it('routes error 4092 through ptosc', async () => {
    const err = new Error('unsupported');
    err.errno = 4092;
    const knex = createKnexMock({
      rawImpl: vi.fn((sql) => {
        if (sql === 'SELECT VERSION() AS version') {
          return Promise.resolve([{ version: '8.0.0' }]);
        }
        if (/ALGORITHM=INSTANT/.test(sql)) {
          return err ? Promise.reject(err) : Promise.resolve();
        }
        return Promise.resolve();
      }),
    });
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT');
    expect(knex.raw).toHaveBeenCalledWith(expect.stringMatching(/ALGORITHM=INSTANT/));
    expect(runPtoscProcess).toHaveBeenCalled();
  });

  it('routes unsupported INSTANT message through ptosc', async () => {
    const err = new Error('ALGORITHM=INSTANT is not supported');
    const knex = createKnexMock({
      rawImpl: vi.fn((sql) => {
        if (sql === 'SELECT VERSION() AS version') {
          return Promise.resolve([{ version: '8.0.0' }]);
        }
        if (/ALGORITHM=INSTANT/.test(sql)) {
          return Promise.reject(err);
        }
        return Promise.resolve();
      }),
    });
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT');
    expect(knex.raw).toHaveBeenCalledWith(expect.stringMatching(/ALGORITHM=INSTANT/));
    expect(runPtoscProcess).toHaveBeenCalled();
  });

  it('skips INSTANT on MySQL 5.7', async () => {
    const knex = createKnexMock({
      rawImpl: vi.fn((sql) => {
        if (sql === 'SELECT VERSION() AS version') {
          return Promise.resolve([{ version: '5.7.34' }]);
        }
        if (/ALGORITHM=INSTANT/.test(sql)) {
          return Promise.resolve();
        }
        return Promise.resolve();
      }),
    });
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT');
    expect(knex.raw).toHaveBeenCalledWith('SELECT VERSION() AS version');
    expect(knex.raw).not.toHaveBeenCalledWith(expect.stringMatching(/ALGORITHM=INSTANT/));
    expect(runPtoscProcess).toHaveBeenCalled();
  });
});

