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


describe('ptoscMinRows fast path', () => {
  it('runs native ALTER when row count below threshold', async () => {
    const knex = createKnexMock({
      rawImpl: vi.fn((sql) => {
        if (sql.startsWith('SELECT TABLE_ROWS FROM information_schema.tables')) {
          return Promise.resolve([{ TABLE_ROWS: 5 }]);
        }
        return Promise.resolve();
      }),
    });
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD COLUMN foo INT', { ptoscMinRows: 10 });
    expect(knex.raw).toHaveBeenCalledWith(
      'SELECT TABLE_ROWS FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      ['testdb', 'widgets']
    );
    expect(knex.raw).toHaveBeenLastCalledWith('ALTER TABLE widgets ADD COLUMN foo INT');
    expect(runPtoscProcess).not.toHaveBeenCalled();
  });
});
