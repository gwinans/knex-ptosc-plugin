import { describe, expect, it, vi } from 'vitest';
import { acquireMigrationLock } from '../src/lock.js';

describe('acquireMigrationLock within transaction', () => {
  it('uses a separate connection outside the transaction', async () => {
    const externalKnex = vi.fn();
    externalKnex.schema = { hasTable: vi.fn().mockResolvedValue(true) };
    externalKnex.destroy = vi.fn().mockResolvedValue();
    const qb = {
      where: vi.fn().mockReturnThis(),
      update: vi.fn().mockResolvedValue(1),
      select: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ is_locked: 1 }),
    };
    externalKnex.mockReturnValue(qb);
    const createKnex = vi.fn(() => externalKnex);

    const trx = vi.fn();
    trx.isTransaction = true;
    trx.client = { config: {} };
    trx.constructor = createKnex;

    const lock = await acquireMigrationLock(trx);
    expect(createKnex).toHaveBeenCalledWith(trx.client.config);
    expect(externalKnex).toHaveBeenCalled();
    await lock.release();
    expect(externalKnex.destroy).toHaveBeenCalled();
    expect(trx).not.toHaveBeenCalled();
  });
});
