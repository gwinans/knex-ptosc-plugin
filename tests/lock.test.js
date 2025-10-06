import { describe, it, expect, vi } from 'vitest';
import { acquireMigrationLock } from '../src/lock.js';
import { createLockKnexMock } from './helpers/knex-mock.js';

describe('acquireMigrationLock', () => {
  it('acquires and releases the lock when available', async () => {
    const knex = createLockKnexMock(0);
    const { release } = await acquireMigrationLock(knex);
    expect(knex._state.is_locked).toBe(1);
    await release();
    expect(knex._state.is_locked).toBe(0);
  });

  it('allows only one caller to proceed and avoids busy looping while waiting', async () => {
    const knex = createLockKnexMock(0);
    const first = await acquireMigrationLock(knex);
    expect(knex._state.selectCalls).toBe(1);

    let secondResolved = false;
    const secondPromise = acquireMigrationLock(knex).then((result) => {
      secondResolved = true;
      return result;
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(secondResolved).toBe(false);
    expect(knex._state.selectCalls).toBe(2);
    expect(knex._state.waiters.length).toBe(1);

    await first.release();
    const second = await secondPromise;

    expect(knex._state.selectCalls).toBe(2);
    expect(knex._state.is_locked).toBe(1);

    await second.release();
    expect(knex._state.is_locked).toBe(0);
  });

  it('throws after timeout when lock remains held', async () => {
    const knex = createLockKnexMock(1);
    await expect(acquireMigrationLock(knex, { timeoutMs: 50 })).rejects.toThrow(/Timeout acquiring/);
    expect(knex._state.is_locked).toBe(1);
  });

  it('checks required tables concurrently before acquiring the lock', async () => {
    const knex = createLockKnexMock(0);
    const delay = 100;
    let calls = 0;
    knex.schema.hasTable = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, delay));
      return true;
    };
    const start = Date.now();
    const { release } = await acquireMigrationLock(knex, { timeoutMs: 1000 });
    const duration = Date.now() - start;
    expect(calls).toBe(2);
    expect(duration).toBeLessThan(delay * 1.5);
    expect(knex._state.is_locked).toBe(1);
    await release();
    expect(knex._state.is_locked).toBe(0);
  });

  it.each(['knex_migrations', 'knex_migrations_lock'])(
    'throws if %s table is missing',
    async (missingTable) => {
      const knex = createLockKnexMock(0);
      knex.schema.hasTable = vi.fn(async (table) => table !== missingTable);
      await expect(acquireMigrationLock(knex)).rejects.toThrow(
        'Required Knex migration tables do not exist. Ensure knex_migrations and knex_migrations_lock are created before running pt-osc migrations.',
      );
    },
  );

  it('logs and surfaces errors from lock update', async () => {
    const error = new Error('update failed');
    const knex = createLockKnexMock(0, { updateError: error });
    const logger = { error: vi.fn() };
    await expect(acquireMigrationLock(knex, { logger })).rejects.toThrow('update failed');
    expect(logger.error).toHaveBeenCalledWith('Failed to acquire migration lock', error);
  });

  it('refuses to override an existing lock set outside this transaction', async () => {
    const knex = createLockKnexMock(1, { externalLock: false });
    await expect(acquireMigrationLock(knex)).rejects.toThrow('Migration lock already held in knex_migrations_lock');
    expect(knex._state.is_locked).toBe(1);
  });

  it('logs and surfaces errors from lock status read', async () => {
    const error = new Error('select failed');
    const knex = createLockKnexMock(1, { selectError: error });
    const logger = { error: vi.fn() };
    await expect(
      acquireMigrationLock(knex, { logger, timeoutMs: 50 }),
    ).rejects.toThrow('select failed');
    expect(logger.error).toHaveBeenCalledWith('Failed to read migration lock status', error);
  });
});
