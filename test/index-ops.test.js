import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import child from 'child_process';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { alterTableWithPtosc } from '../index.js';

function createKnex(alterSql) {
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
    if (sql === alterSql) return Promise.resolve();
    throw new Error('unexpected sql');
  });
  knex.schema = {
    hasTable: vi.fn().mockResolvedValue(true),
    alterTable: vi.fn((_name, _cb) => ({
      toSQL: () => [{ sql: alterSql, bindings: [] }]
    }))
  };
  return knex;
}

describe('index operations bypass ptosc', () => {
  let spawnSpy;
  let spawnSyncSpy;

  beforeEach(() => {
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
    spawnSyncSpy = vi
      .spyOn(child, 'spawnSync')
      .mockReturnValue({ status: 0, stdout: Buffer.from('/usr/bin/pt-online-schema-change\n') });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs ADD INDEX natively', async () => {
    const sql = 'ALTER TABLE `users` ADD INDEX `idx_age` (`age`)';
    const knex = createKnex(sql);
    await alterTableWithPtosc(knex, 'users', () => {}, {});
    expect(knex.raw).toHaveBeenCalledWith(sql);
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(spawnSyncSpy).not.toHaveBeenCalled();
  });

  it('runs DROP INDEX natively', async () => {
    const sql = 'ALTER TABLE `users` DROP INDEX `idx_age`';
    const knex = createKnex(sql);
    await alterTableWithPtosc(knex, 'users', () => {}, {});
    expect(knex.raw).toHaveBeenCalledWith(sql);
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(spawnSyncSpy).not.toHaveBeenCalled();
  });
});
