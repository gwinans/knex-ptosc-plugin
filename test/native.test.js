import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import child from 'child_process';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { alterTableWithPtosc } from '../index.js';

function createKnex(rawImpl) {
  const qb = {
    where: vi.fn().mockReturnThis(),
    update: vi.fn().mockResolvedValue(1),
    select: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ is_locked: 0 })
  };
  const knex = vi.fn().mockReturnValue(qb);
  knex.client = { config: { connection: { database: 'db', host: 'localhost', user: 'root' } } };
  knex.raw = vi.fn((sql, bindings) => {
    if (bindings) return { toQuery: () => sql };
    return rawImpl(sql);
  });
  knex.schema = {
    hasTable: vi.fn().mockResolvedValue(true),
    alterTable: vi.fn((_name, _cb) => ({
      toSQL: () => [{ sql: 'ALTER TABLE `users` ADD COLUMN `age` INT', bindings: [] }]
    }))
  };
  return knex;
}

describe('native instant alter', () => {
  let spawnSpy;
  let spawnSyncSpy;

  beforeEach(() => {
    spawnSyncSpy = vi
      .spyOn(child, 'spawnSync')
      .mockReturnValue({ status: 0, stdout: Buffer.from('/usr/bin/pt-online-schema-change\n') });
    spawnSpy = vi.spyOn(child, 'spawn').mockImplementation(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const proc = new EventEmitter();
      proc.stdout = stdout;
      proc.stderr = stderr;
      setImmediate(() => {
        stdout.emit('data', 'ok');
        stdout.end();
        stderr.end();
        proc.emit('close', 0);
      });
      return proc;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses native alter when supported', async () => {
    const rawImpl = vi.fn((sql) => {
      if (/SELECT VERSION/i.test(sql)) return Promise.resolve([{ version: '8.0.0' }]);
      if (/ALTER TABLE/i.test(sql)) return Promise.resolve();
      throw new Error('unexpected sql');
    });
    const knex = createKnex(rawImpl);
    await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, {});
    expect(rawImpl).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE users ADD COLUMN `age` INT, ALGORITHM=INSTANT')
    );
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('falls back to ptosc on unsupported instant alter', async () => {
    const rawImpl = vi.fn((sql) => {
      if (/SELECT VERSION/i.test(sql)) return Promise.resolve([{ version: '8.0.0' }]);
      if (/ALTER TABLE/i.test(sql)) {
        const err = new Error('unsupported ALGORITHM=INSTANT');
        err.errno = 1846;
        return Promise.reject(err);
      }
      throw new Error('unexpected sql');
    });
    const knex = createKnex(rawImpl);
    await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, {});
    expect(spawnSpy).toHaveBeenCalledTimes(2);
  });

  it('skips native alter on MySQL 5.7', async () => {
    const rawImpl = vi.fn((sql) => {
      if (/SELECT VERSION/i.test(sql)) return Promise.resolve([{ version: '5.7.42' }]);
      if (/ALTER TABLE/i.test(sql)) throw new Error('should not reach native alter');
      return Promise.resolve();
    });
    const knex = createKnex(rawImpl);
    await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, {});
    expect(rawImpl).toHaveBeenCalledTimes(1);
    expect(spawnSpy).toHaveBeenCalledTimes(2);
  });
});
