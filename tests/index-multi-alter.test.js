import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(),
}));

vi.mock('../src/lock.js', () => ({
  acquireMigrationLock: vi.fn(),
}));

import { alterTableWithPtosc } from '../src/index.js';
import { runPtoscProcess } from '../src/ptosc-runner.js';
import { acquireMigrationLock } from '../src/lock.js';
import { createKnexMockBuilder } from './helpers/knex-mock.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('alterTableWithPtosc with multiple ALTER statements', () => {
  it('acquires/releases lock, runs index natively, aggregates ptosc stats', async () => {
    const release = vi.fn();
    acquireMigrationLock.mockResolvedValue({ release });

    runPtoscProcess
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ statistics: { first: 1 } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ statistics: { second: 2 } });

    const knex = createKnexMockBuilder({
      toSQL: (name) => [
        { sql: `ALTER TABLE ${name} ADD INDEX idx_foo (foo)` },
        { sql: `ALTER TABLE ${name} MODIFY COLUMN bar INT NOT NULL` },
        { sql: `ALTER TABLE ${name} MODIFY COLUMN baz VARCHAR(50)` },
      ],
    });
    const stats = await alterTableWithPtosc(knex, 'widgets', () => {}, { forcePtosc: true, statistics: true });

    expect(acquireMigrationLock).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);

    const execCalls = knex.raw.mock.calls.filter(([, bindings]) => bindings === undefined);
    expect(execCalls).toEqual([["ALTER TABLE widgets ADD INDEX idx_foo (foo)"]]);

    expect(runPtoscProcess).toHaveBeenCalledTimes(4);
    expect(stats).toEqual([{ first: 1 }, { second: 2 }]);
  });
});

