import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import child from 'child_process';
import { alterTableWithBuilder } from '../index.js';

function createKnex() {
  const qb = {
    where: vi.fn().mockReturnThis(),
    update: vi.fn().mockResolvedValue(1)
  };
  const knex = vi.fn().mockReturnValue(qb);
  knex.client = { config: { connection: { database: 'db', host: 'localhost', user: 'root' } } };
  knex.raw = (sql, bindings) => ({ toQuery: () => sql });
  knex.schema = {
    hasTable: vi.fn().mockResolvedValue(true),
    alterTable: vi.fn((_name, _cb) => ({
      toSQL: () => [{ sql: 'ALTER TABLE `users` ADD COLUMN `age` INT', bindings: [] }]
    }))
  };
  return knex;
}

describe('knex-ptosc-plugin', () => {
  let execFileSpy;

    beforeEach(() => {
      execFileSpy = vi
        .spyOn(child, 'execFile')
        .mockImplementation((cmd, args, opts, cb) => {
          cb(null, 'ok', '');
        });
    });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes --alter as a separate arg (no shell quoting)', async () => {
    const knex = createKnex();
    await alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, {});
    const args = execFileSpy.mock.calls[0][1];
    expect(args[0]).toBe('--alter');
    expect(args[1]).toContain('ADD COLUMN `age` INT');
  });

  it('extracts ALTER clause from builder SQL and runs twice (dry + exec)', async () => {
    const knex = createKnex();
    await alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, {});
    expect(execFileSpy).toHaveBeenCalledTimes(2); // dry-run + execute
  });

  it('supports additional pt-osc flags', async () => {
    const knex = createKnex();
    await alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, {
      analyzeBeforeSwap: false,
      checkReplicaLag: true,
      maxLag: 10,
      chunkSize: 2000
    });
    const args = execFileSpy.mock.calls[0][1];
    expect(args).toContain('--noanalyze-before-swap');
    expect(args).toContain('--check-replica-lag');
    const lagIdx = args.indexOf('--max-lag');
    expect(args[lagIdx + 1]).toBe('10');
    const sizeIdx = args.indexOf('--chunk-size');
    expect(args[sizeIdx + 1]).toBe('2000');
  });

    it('uses a custom logger when provided', async () => {
      const knex = createKnex();
      const logger = { log: vi.fn(), error: vi.fn() };
      const consoleSpy = vi.spyOn(console, 'log');
      await alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, { logger });
      expect(logger.log).toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('surfaces pt-osc errors with code and output', async () => {
      const knex = createKnex();
      execFileSpy.mockImplementation((cmd, args, opts, cb) => {
        const err = new Error('boom');
        err.code = 42;
        cb(err, 'out', 'err');
      });
      await expect(
        alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, {})
      ).rejects.toMatchObject({ code: 42, stdout: 'out', stderr: 'err' });
    });

    it('passes maxBuffer to execFile', async () => {
      const knex = createKnex();
      await alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, { maxBuffer: 1024 });
      expect(execFileSpy.mock.calls[0][2].maxBuffer).toBe(1024);
    });
  });
