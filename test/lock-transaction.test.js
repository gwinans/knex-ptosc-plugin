import { describe, expect, it, vi } from 'vitest';

let createKnex;
vi.mock('knex', () => ({ default: (...args) => createKnex(...args) }));

describe('acquireMigrationLock within transaction', () => {
  it('returns a no-op release when the lock is already held', async () => {
    createKnex = vi.fn(() => {
      throw new Error('should not be called');
    });

    const qb = {
      select: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ is_locked: 1 }),
    };
    const trx = vi.fn().mockReturnValue(qb);
    trx.isTransaction = true;
    trx.schema = { hasTable: vi.fn().mockResolvedValue(true) };
    trx.client = { config: { client: 'mock' } };

    const { acquireMigrationLock } = await import('../src/lock.js');

    const lock = await acquireMigrationLock(trx);
    expect(createKnex).not.toHaveBeenCalled();
    expect(trx).toHaveBeenCalledWith('knex_migrations_lock');
    await lock.release();
  });
});
