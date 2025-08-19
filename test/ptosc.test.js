import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import child from 'child_process';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { alterTableWithBuilder } from '../index.js';

function createKnex(updateMock) {
  const qb = {
    where: vi.fn().mockReturnThis(),
    update: updateMock || vi.fn().mockResolvedValue(1)
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
  let spawnSpy;

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes --alter as a separate arg (no shell quoting)', async () => {
    const knex = createKnex();
    await alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, {});
    const args = spawnSpy.mock.calls[0][1];
    expect(args[0]).toBe('--alter');
    expect(args[1]).toContain('ADD COLUMN `age` INT');
  });

  it('extracts ALTER clause from builder SQL and runs twice (dry + exec)', async () => {
    const knex = createKnex();
    await alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, {});
    expect(spawnSpy).toHaveBeenCalledTimes(2); // dry-run + execute
  });

  it('supports additional pt-osc flags', async () => {
    const knex = createKnex();
    await alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, {
      analyzeBeforeSwap: false,
      checkReplicaLag: true,
      maxLag: 10,
      chunkSize: 2000
    });
    const args = spawnSpy.mock.calls[0][1];
    expect(args).toContain('--noanalyze-before-swap');
    expect(args).toContain('--check-replica-lag');
    const lagIdx = args.indexOf('--max-lag');
    expect(args[lagIdx + 1]).toBe('10');
    const sizeIdx = args.indexOf('--chunk-size');
    expect(args[sizeIdx + 1]).toBe('2000');
  });

  it('passes custom load metric names', async () => {
    const knex = createKnex();
    await alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, {
      maxLoad: 100,
      maxLoadMetric: 'Threads_connected',
      criticalLoad: 50,
      criticalLoadMetric: 'Threads_running'
    });
    const args = spawnSpy.mock.calls[0][1];
    const maxIdx = args.indexOf('--max-load');
    expect(args[maxIdx + 1]).toBe('Threads_connected=100');
    const criticalIdx = args.indexOf('--critical-load');
    expect(args[criticalIdx + 1]).toBe('Threads_running=50');
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
      spawnSpy.mockImplementationOnce(() => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const proc = new EventEmitter();
        proc.stdout = stdout;
        proc.stderr = stderr;
        setImmediate(() => {
          stdout.emit('data', 'out');
          stderr.emit('data', 'err');
          stdout.end();
          stderr.end();
          proc.emit('close', 42);
        });
        return proc;
      });
      await expect(
        alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, {})
      ).rejects.toMatchObject({ code: 42, stdout: 'out', stderr: 'err' });
    });

    it('passes maxBuffer to spawn', async () => {
      const knex = createKnex();
      await alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, { maxBuffer: 1024 });
      expect(spawnSpy.mock.calls[0][2].maxBuffer).toBe(1024);
    });

    it('emits progress updates', async () => {
      const knex = createKnex();
      const onProgress = vi.fn();
      spawnSpy.mockImplementationOnce(() => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const proc = new EventEmitter();
        proc.stdout = stdout;
        proc.stderr = stderr;
        setImmediate(() => {
          stdout.emit('data', 'Processing 12.5% complete');
          stdout.end();
          stderr.end();
          proc.emit('close', 0);
        });
        return proc;
      });
      await alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, { onProgress });
      expect(onProgress).toHaveBeenCalledWith(12.5);
    });

    it('logs and rethrows errors when releasing the lock', async () => {
      const releaseError = new Error('release failed');
      const updateMock = vi
        .fn()
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(releaseError);
      const knex = createKnex(updateMock);
      const logger = { log: vi.fn(), error: vi.fn() };
      await expect(
        alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, { logger })
      ).rejects.toThrow('release failed');
      expect(logger.error).toHaveBeenCalled();
    });
  });
