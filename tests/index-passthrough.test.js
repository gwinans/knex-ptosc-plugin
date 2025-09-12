import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKnexMockRaw, createKnexMockBuilder } from './helpers/knex-mock.js';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(() => Promise.resolve({ statistics: {} })),
}));

import { alterTableWithPtoscRaw, alterTableWithPtosc } from '../src/index.js';
import { runPtoscProcess } from '../src/ptosc-runner.js';

beforeEach(() => {
  vi.clearAllMocks();
});


describe('index clause passthrough', () => {
  it('runs ADD INDEX via alterTableWithPtoscRaw', async () => {
    const knex = createKnexMockRaw();
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD INDEX idx_foo (foo)');
    expect(knex.raw).toHaveBeenCalledWith('ALTER TABLE widgets ADD INDEX idx_foo (foo)');
    expect(runPtoscProcess).not.toHaveBeenCalled();
  });

  it('runs ADD UNIQUE KEY via alterTableWithPtoscRaw', async () => {
    const knex = createKnexMockRaw();
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD UNIQUE KEY idx_foo (foo)');
    expect(knex.raw).toHaveBeenCalledWith('ALTER TABLE widgets ADD UNIQUE KEY idx_foo (foo)');
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
