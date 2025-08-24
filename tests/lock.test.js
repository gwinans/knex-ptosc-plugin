import { describe, it, expect, vi } from 'vitest';
import { acquireMigrationLock } from '../src/lock.js';

function createKnexMock(initial = 0) {
  const state = { is_locked: initial };
  const knex = () => {
    const builder = {
      where() { return builder; },
      update: async (obj) => {
        if (obj.is_locked === 1 && state.is_locked === 0) {
          state.is_locked = 1;
          return 1;
        }
        if (obj.is_locked === 0 && state.is_locked === 1) {
          state.is_locked = 0;
          return 1;
        }
        return 0;
      },
      select() { return builder; },
      first: async () => ({ is_locked: state.is_locked }),
    };
    return builder;
  };
  knex.schema = {
    hasTable: async () => true,
  };
  knex._state = state;
  return knex;
}

describe('acquireMigrationLock', () => {
  it('acquires and releases the lock when available', async () => {
    const knex = createKnexMock(0);
    const { release } = await acquireMigrationLock(knex);
    expect(knex._state.is_locked).toBe(1);
    await release();
    expect(knex._state.is_locked).toBe(0);
  });

  it('waits for existing lock and then acquires it', async () => {
    const knex = createKnexMock(1);
    setTimeout(() => {
      knex._state.is_locked = 0;
    }, 20);
    const { release } = await acquireMigrationLock(knex, { intervalMs: 10, timeoutMs: 200 });
    expect(knex._state.is_locked).toBe(1);
    await release();
    expect(knex._state.is_locked).toBe(0);
  });

  it('throws after timeout when lock remains held', async () => {
    const knex = createKnexMock(1);
    await expect(acquireMigrationLock(knex, { intervalMs: 10, timeoutMs: 50 })).rejects.toThrow(/Timeout acquiring/);
    expect(knex._state.is_locked).toBe(1);
  });

  it('checks required tables concurrently before acquiring the lock', async () => {
    const knex = createKnexMock(0);
    const delay = 100;
    let calls = 0;
    knex.schema.hasTable = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, delay));
      return true;
    };
    const start = Date.now();
    const { release } = await acquireMigrationLock(knex, { timeoutMs: 1000, intervalMs: 10 });
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
      const knex = createKnexMock(0);
      knex.schema.hasTable = vi.fn(async (table) => table !== missingTable);
      await expect(acquireMigrationLock(knex)).rejects.toThrow(
        'Required Knex migration tables do not exist. Ensure knex_migrations and knex_migrations_lock are created before running pt-osc migrations.',
      );
    },
  );
});
