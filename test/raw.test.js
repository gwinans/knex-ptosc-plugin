import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import child from 'child_process';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { alterTableWithPtoscRaw } from '../index.js';
import * as lock from '../src/lock.js';

function createKnex() {
  const qb = {
    where: vi.fn().mockReturnThis(),
    update: vi.fn().mockResolvedValue(1),
    select: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ is_locked: 0 })
  };
  const knex = vi.fn().mockReturnValue(qb);
  knex.client = { config: { connection: { database: 'db', host: 'localhost', user: 'root' } } };
  knex.raw = vi.fn(sql => {
    if (/SELECT VERSION/i.test(sql)) return Promise.resolve([{ version: '5.7.42' }]);
    if (/^ALTER TABLE/i.test(sql)) return Promise.resolve();
    throw new Error('unexpected sql');
  });
  return knex;
}

describe('alterTableWithPtoscRaw', () => {
  let spawnSpy;
  let spawnSyncSpy;
  let releaseSpy;

  beforeEach(() => {
    releaseSpy = vi.fn();
    vi.spyOn(lock, 'acquireMigrationLock').mockResolvedValue({ release: releaseSpy });
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

  it('runs pt-osc for raw alters and releases the lock', async () => {
    const knex = createKnex();
    await alterTableWithPtoscRaw(knex, 'ALTER TABLE `users` ADD COLUMN `age` INT');
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expect(releaseSpy).toHaveBeenCalled();
  });

  it('runs index operations natively', async () => {
    const sql = 'ALTER TABLE `users` ADD INDEX `idx_age` (`age`)';
    const knex = createKnex();
    knex.raw.mockImplementation(sqlArg => {
      if (sqlArg === sql) return Promise.resolve();
      throw new Error('unexpected sql');
    });
    await alterTableWithPtoscRaw(knex, sql);
    expect(knex.raw).toHaveBeenCalledWith(sql);
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(spawnSyncSpy).not.toHaveBeenCalled();
  });

  it('supports additional pt-osc flags', async () => {
    const knex = createKnex();
    await alterTableWithPtoscRaw(
      knex,
      'ALTER TABLE `users` ADD COLUMN `age` INT',
      {
        analyzeBeforeSwap: false,
        checkReplicaLag: true,
        maxLag: 10,
        chunkSize: 2000
      }
    );
    const args = spawnSpy.mock.calls[0][1];
    expect(args).toContain('--noanalyze-before-swap');
    expect(args).toContain('--check-replica-lag');
    const lagIdx = args.indexOf('--max-lag');
    expect(args[lagIdx + 1]).toBe('10');
    const sizeIdx = args.indexOf('--chunk-size');
    expect(args[sizeIdx + 1]).toBe('2000');
  });

  it('rejects non-ALTER statements', async () => {
    const knex = createKnex();
    await expect(alterTableWithPtoscRaw(knex, 'SELECT 1')).rejects.toThrow(/Only ALTER TABLE/);
    expect(releaseSpy).toHaveBeenCalled();
  });
});
