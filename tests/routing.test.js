import { expect, it, vi } from 'vitest';
import { alterTableWithPtoscRaw } from '../src/index.js';
import { createKnexMock } from './helpers/knex-mock.js';
import { buildPtoscArgs } from '../src/ptosc-runner.js';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(async () => ({ statistics: {} })),
}));

it('only groups adjacent compatible changes and preserves schema and order', async () => {
  const knex = createKnexMock();
  const onPlan = vi.fn();
  const changes = ['MODIFY a INT', 'MODIFY b BIGINT', 'MODIFY b INT',
    'ADD COLUMN c INT AFTER a', 'MODIFY d INT'];
  await alterTableWithPtoscRaw(knex, ...changes.map(c => 'ALTER TABLE `other`.`t` ' + c),
    { groupAlters: true, forcePtosc: true, lockOwner: 'knex', onPlan, ptoscMinRows: 100 });
  expect(knex._state.selectCalls).toBe(0);
  expect(knex.raw).not.toHaveBeenCalled();
  expect(onPlan.mock.calls.map(([s]) => s.clause)).toEqual([
    'MODIFY a INT, MODIFY b BIGINT', ...changes.slice(2)
  ]);
  expect(buildPtoscArgs).toHaveBeenCalledWith(expect.objectContaining({ database: 'other', table: 't' }));
});

it.each(['ADD INDEX ix (a), MODIFY b INT', "ADD COLUMN tag VARCHAR(30) DEFAULT 'ADD INDEX'"])(
  'routes the full clause through an INSTANT attempt: %s', async clause => {
    const knex = createKnexMock({ rawImpl: vi.fn(async () => [[{ version: '8.0.40' }]]) });
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE t ' + clause);
    expect(knex.raw).toHaveBeenLastCalledWith('ALTER TABLE t ' + clause + ', ALGORITHM=INSTANT');
  });

it('propagates a native DDL failure without retrying', async () => {
  const failure = new Error('lost connection');
  const knex = createKnexMock({ rawImpl: vi.fn()
    .mockResolvedValueOnce([[{ TABLE_ROWS: 1 }]]).mockRejectedValueOnce(failure) });
  await expect(alterTableWithPtoscRaw(knex, 'ALTER TABLE t MODIFY qty INT', { ptoscMinRows: 5 }))
    .rejects.toBe(failure);
  expect(knex.raw).toHaveBeenCalledTimes(2);
  expect(knex._state.is_locked).toBe(0);
});
