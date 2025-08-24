import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import child from 'child_process';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { alterTableWithPtosc } from '../index.js';
import { acquireMigrationLock } from '../src/lock.js';

function createKnex(updateMock, rowCount) {
  const qb = {
    where: vi.fn().mockReturnThis(),
    update: updateMock || vi.fn().mockResolvedValue(1),
    select: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ is_locked: 0 })
  };
  const knex = vi.fn().mockReturnValue(qb);
  knex.client = { config: { connection: { database: 'db', host: 'localhost', user: 'root' } } };
  knex.raw = vi.fn((sql, bindings) => {
    if (bindings) {
      if (/information_schema\.tables/i.test(sql)) {
        return Promise.resolve([{ TABLE_ROWS: rowCount ?? 0 }]);
      }
      return { toQuery: () => sql };
    }
    if (/SELECT VERSION/i.test(sql)) return Promise.resolve([{ version: '5.7.42' }]);
    if (/^ALTER TABLE/i.test(sql)) return Promise.resolve();
    throw new Error('unexpected sql');
  });
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
  let spawnSyncSpy;

  beforeEach(() => {
    spawnSyncSpy = vi.spyOn(child, 'spawnSync').mockReturnValue({ status: 0, stdout: Buffer.from('/usr/bin/pt-online-schema-change\n') });
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
    await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, {});
    const args = spawnSpy.mock.calls[0][1];
    expect(args[0]).toBe('--alter');
    expect(args[1]).toContain('ADD COLUMN `age` INT');
  });

  it('extracts ALTER clause from builder SQL and runs twice (dry + exec)', async () => {
    const knex = createKnex();
    await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, {});
    expect(spawnSpy).toHaveBeenCalledTimes(2); // dry-run + execute
  });

  it('executes ALTER natively when row count is below threshold', async () => {
    const knex = createKnex(undefined, 10);
    await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { ptoscMinRows: 100 });
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(knex.raw).toHaveBeenCalledWith(
      'SELECT TABLE_ROWS FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      ['db', 'users']
    );
    expect(knex.raw).toHaveBeenCalledWith('ALTER TABLE users ADD COLUMN `age` INT');
  });

  it('supports additional pt-osc flags', async () => {
    const knex = createKnex();
    await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, {
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
    await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, {
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
      await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { logger });
      expect(logger.log).toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('throws when logger.log is not a function', async () => {
      const knex = createKnex();
      await expect(
        alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { logger: { log: true, error: () => {} } })
      ).rejects.toThrow(/logger\.log must be a function/);
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it('throws when logger.error is not a function', async () => {
      const knex = createKnex();
      await expect(
        alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { logger: { log: () => {}, error: true } })
      ).rejects.toThrow(/logger\.error must be a function/);
      expect(spawnSpy).not.toHaveBeenCalled();
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
        alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, {})
      ).rejects.toMatchObject({ code: 42, stdout: 'out', stderr: 'err' });
    });

    it('logs full pt-osc output when the command fails', async () => {
      const knex = createKnex();
      const logger = { log: vi.fn(), error: vi.fn() };
      spawnSpy.mockImplementationOnce(() => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const proc = new EventEmitter();
        proc.stdout = stdout;
        proc.stderr = stderr;
        setImmediate(() => {
          stdout.emit('data', 'out-line\n');
          stderr.emit('data', 'err-line\n');
          stdout.end();
          stderr.end();
          proc.emit('close', 1);
        });
        return proc;
      });
      await expect(
        alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { logger })
      ).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('out-line'));
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('err-line'));
    });

    it('includes trailing output without newline when the command fails', async () => {
      const knex = createKnex();
      const logger = { log: vi.fn(), error: vi.fn() };
      spawnSpy.mockImplementationOnce(() => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const proc = new EventEmitter();
        proc.stdout = stdout;
        proc.stderr = stderr;
        setImmediate(() => {
          stdout.emit('data', 'out1\n');
          stdout.emit('data', 'out2');
          stderr.emit('data', 'err1\n');
          stderr.emit('data', 'err2');
          stdout.end();
          stderr.end();
          proc.emit('close', 1);
        });
        return proc;
      });
      const prev = process.env.DEBUG;
      process.env.DEBUG = 'knex-ptosc-plugin';
      await expect(
        alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { logger })
      ).rejects.toThrow();
      process.env.DEBUG = prev;
      const stdoutCall = logger.error.mock.calls.find(c => c[0].startsWith('[PT-OSC] stdout:'));
      expect(stdoutCall[0]).toContain('out1\nout2');
      const stderrCall = logger.error.mock.calls.find(c => c[0].startsWith('[PT-OSC] stderr:'));
      expect(stderrCall[0]).toContain('err1\nerr2');
    });

    it('does not pass maxBuffer to spawn', async () => {
      const knex = createKnex();
      await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { maxBuffer: 1024 });
      expect(spawnSpy.mock.calls[0][2].maxBuffer).toBeUndefined();
    });

    it('rejects when chunkSize is non-positive', async () => {
      const knex = createKnex();
      await expect(
        alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { chunkSize: 0 })
      ).rejects.toThrow(/chunkSize must be a positive integer/);
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it('rejects when maxLoad is non-positive', async () => {
      const knex = createKnex();
      await expect(
        alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { maxLoad: -1 })
      ).rejects.toThrow(/maxLoad must be a positive integer/);
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it('rejects unsupported alterForeignKeysMethod', async () => {
      const knex = createKnex();
      await expect(
        alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { alterForeignKeysMethod: 'invalid' })
      ).rejects.toThrow(/alterForeignKeysMethod must be one of/);
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    const positiveIntOptions = ['criticalLoad', 'checkInterval', 'chunkIndexColumns', 'maxLag', 'maxBuffer'];
    for (const opt of positiveIntOptions) {
      it(`rejects when ${opt} is non-positive`, async () => {
        const knex = createKnex();
        await expect(
          alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { [opt]: 0 })
        ).rejects.toThrow(new RegExp(`${opt} must be a positive integer`));
        expect(spawnSpy).not.toHaveBeenCalled();
      });
    }

    const positiveNumberOptions = ['chunkSizeLimit', 'chunkTime'];
    for (const opt of positiveNumberOptions) {
      it(`rejects when ${opt} is non-positive`, async () => {
        const knex = createKnex();
        await expect(
          alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { [opt]: 0 })
        ).rejects.toThrow(new RegExp(`${opt} must be a positive number`));
        expect(spawnSpy).not.toHaveBeenCalled();
      });
    }

    const booleanOptions = [
      'analyzeBeforeSwap',
      'checkAlter',
      'checkForeignKeys',
      'checkPlan',
      'checkReplicationFilters',
      'checkReplicaLag',
      'dropNewTable',
      'dropOldTable',
      'dropTriggers',
      'checkUniqueKeyChange',
      'statistics',
      'forcePtosc'
    ];
    for (const opt of booleanOptions) {
      it(`rejects when ${opt} is not boolean`, async () => {
        const knex = createKnex();
        await expect(
          alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { [opt]: 'yes' })
        ).rejects.toThrow(new RegExp(`${opt} must be a boolean`));
        expect(spawnSpy).not.toHaveBeenCalled();
      });
    }

    it('rejects when ptoscMinRows is negative', async () => {
      const knex = createKnex();
      await expect(
        alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { ptoscMinRows: -1 })
      ).rejects.toThrow(/ptoscMinRows must be a non-negative integer/);
      expect(spawnSpy).not.toHaveBeenCalled();
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
          stdout.emit('data', 'Processing 12.5% 00:03 remain\n');
          stdout.end();
          stderr.end();
          proc.emit('close', 0);
        });
        return proc;
      });
      await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { onProgress });
      expect(onProgress).toHaveBeenCalledWith(12.5, '00:03');
    });

    it('logs ETA with progress updates', async () => {
      const knex = createKnex();
      const logger = { log: vi.fn(), error: vi.fn() };
      const onProgress = vi.fn();

      // Dry run
      spawnSpy.mockImplementationOnce(() => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const proc = new EventEmitter();
        proc.stdout = stdout;
        proc.stderr = stderr;
        setImmediate(() => {
          stdout.end();
          stderr.end();
          proc.emit('close', 0);
        });
        return proc;
      });

      // Execution with progress including ETA
      spawnSpy.mockImplementationOnce(() => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const proc = new EventEmitter();
        proc.stdout = stdout;
        proc.stderr = stderr;
        setImmediate(() => {
          stdout.emit('data', 'Progress: 50% 00:01 remain\n');
          stdout.emit('data', 'Progress: 100% 00:00 remain\n');
          stdout.end();
          stderr.end();
          proc.emit('close', 0);
        });
        return proc;
      });

      await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { logger, onProgress });

      expect(logger.log).toHaveBeenCalledWith('[PT-OSC] 50% ETA: 00:01');
      expect(logger.log).toHaveBeenCalledWith('[PT-OSC] 100% ETA: 00:00');
      expect(onProgress).toHaveBeenCalledWith(50, '00:01');
      expect(onProgress).toHaveBeenCalledWith(100, '00:00');
    });

    it('logs progress without ETA when not provided', async () => {
      const knex = createKnex();
      const logger = { log: vi.fn(), error: vi.fn() };

      // Dry run
      spawnSpy.mockImplementationOnce(() => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const proc = new EventEmitter();
        proc.stdout = stdout;
        proc.stderr = stderr;
        setImmediate(() => {
          stdout.end();
          stderr.end();
          proc.emit('close', 0);
        });
        return proc;
      });

      // Execution with progress but no ETA
      spawnSpy.mockImplementationOnce(() => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const proc = new EventEmitter();
        proc.stdout = stdout;
        proc.stderr = stderr;
        setImmediate(() => {
          stdout.emit('data', 'Progress: 50%\n');
          stdout.emit('data', 'Progress: 100%\n');
          stdout.end();
          stderr.end();
          proc.emit('close', 0);
        });
        return proc;
      });

      await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { logger });

      expect(logger.log).toHaveBeenCalledWith('[PT-OSC] 50%');
    expect(logger.log).toHaveBeenCalledWith('[PT-OSC] 100%');
  });

  it('emits progress updates separated by carriage returns', async () => {
    const knex = createKnex();
    const onProgress = vi.fn();

    // Dry run
    spawnSpy.mockImplementationOnce(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const proc = new EventEmitter();
      proc.stdout = stdout;
      proc.stderr = stderr;
      setImmediate(() => {
        stdout.end();
        stderr.end();
        proc.emit('close', 0);
      });
      return proc;
    });

    // Execution with carriage return separated progress
    spawnSpy.mockImplementationOnce(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const proc = new EventEmitter();
      proc.stdout = stdout;
      proc.stderr = stderr;
      setImmediate(() => {
        stdout.emit('data', 'Progress: 10% 00:02 remain\rProgress: 20% 00:01 remain\r');
        stdout.end();
        stderr.end();
        proc.emit('close', 0);
      });
      return proc;
    });

    await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { onProgress });

    expect(onProgress).toHaveBeenCalledWith(10, '00:02');
    expect(onProgress).toHaveBeenCalledWith(20, '00:01');
  });

  it('emits progress updates from stderr', async () => {
    const knex = createKnex();
    const onProgress = vi.fn();

    // Dry run
    spawnSpy.mockImplementationOnce(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const proc = new EventEmitter();
      proc.stdout = stdout;
      proc.stderr = stderr;
      setImmediate(() => {
        stdout.end();
        stderr.end();
        proc.emit('close', 0);
      });
      return proc;
    });

    // Execution with progress on stderr
    spawnSpy.mockImplementationOnce(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const proc = new EventEmitter();
      proc.stdout = stdout;
      proc.stderr = stderr;
      setImmediate(() => {
        stderr.emit('data', 'Progress: 30% 00:02 remain\n');
        stderr.emit('data', 'Progress: 60% 00:01 remain\n');
        stdout.end();
        stderr.end();
        proc.emit('close', 0);
      });
      return proc;
    });

    await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { onProgress });

    expect(onProgress).toHaveBeenCalledWith(30, '00:02');
    expect(onProgress).toHaveBeenCalledWith(60, '00:01');
  });

  it('parses statistics output and invokes callback', async () => {
    const knex = createKnex();
    const onStats = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };

    // Dry run
    spawnSpy.mockImplementationOnce(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const proc = new EventEmitter();
      proc.stdout = stdout;
      proc.stderr = stderr;
      setImmediate(() => {
        stdout.end();
        stderr.end();
        proc.emit('close', 0);
      });
      return proc;
    });

    // Execution with statistics output
    spawnSpy.mockImplementationOnce(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const proc = new EventEmitter();
      proc.stdout = stdout;
      proc.stderr = stderr;
      setImmediate(() => {
        stdout.emit('data', '# Event Count\n');
        stdout.emit('data', '# ===== =====\n');
        stdout.emit('data', '# inserts 5\n');
        stdout.emit('data', '# updates 2\n');
        stdout.end();
        stderr.end();
        proc.emit('close', 0);
      });
      return proc;
    });

    const result = await alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { statistics: true, onStatistics: onStats, logger });

    const args = spawnSpy.mock.calls[0][1];
    expect(args).toContain('--statistics');
    expect(onStats).toHaveBeenCalledWith({ inserts: 5, updates: 2 });
    expect(logger.log).toHaveBeenCalledWith('[PT-OSC] Statistics: inserts=5, updates=2');
    expect(result).toEqual([{ inserts: 5, updates: 2 }]);
  });

    it('throws a descriptive error when pt-online-schema-change is missing', async () => {
      const knex = createKnex();
      spawnSyncSpy.mockImplementation(() => ({ status: 1, stdout: Buffer.from(''), stderr: Buffer.from('') }));
      await expect(
        alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { ptoscPath: 'pt-online-schema-change-missing' })
      ).rejects.toThrow('pt-online-schema-change binary not found');
      expect(spawnSpy).not.toHaveBeenCalled();
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
        alterTableWithPtosc(knex, 'users', (t) => { t.string('age'); }, { logger })
      ).rejects.toThrow('release failed');
      expect(logger.error).toHaveBeenCalled();
    });

    it('waits for an existing lock to clear before acquiring', async () => {
      vi.useFakeTimers();
      let locked = true;
      const updateMock = vi.fn(() => Promise.resolve(locked ? 0 : 1));
      const firstMock = vi.fn(() => Promise.resolve({ is_locked: locked ? 1 : 0 }));
      const qb = {
        where: vi.fn().mockReturnThis(),
        update: updateMock,
        select: vi.fn().mockReturnThis(),
        first: firstMock
      };
      const knex = vi.fn().mockReturnValue(qb);
      knex.schema = { hasTable: vi.fn().mockResolvedValue(true) };

      const lockPromise = acquireMigrationLock(knex, { timeoutMs: 1000, intervalMs: 100 });
      await vi.advanceTimersByTimeAsync(500);
      expect(updateMock.mock.calls.length).toBeGreaterThan(1);
      locked = false;
      await vi.advanceTimersByTimeAsync(100);
      const lock = await lockPromise;
      await lock.release();
      vi.useRealTimers();
    });

    it('throws when migration tables are missing', async () => {
      const knex = createKnex();
      knex.schema.hasTable.mockResolvedValue(false);
      await expect(acquireMigrationLock(knex)).rejects.toThrow(
        /Required Knex migration tables do not exist/
      );
    });

    it('checks migration tables concurrently', async () => {
      const resolvers = [];
      const hasTable = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
      const knex = createKnex();
      knex.schema.hasTable = hasTable;
      const lockPromise = acquireMigrationLock(knex);
      await Promise.resolve();
      expect(hasTable).toHaveBeenCalledTimes(2);
      resolvers.forEach((r) => r(true));
      const lock = await lockPromise;
      await lock.release();
    });

    it('times out if the lock cannot be acquired', async () => {
      vi.useFakeTimers();
      let locked = true;
      const updateMock = vi.fn(() => Promise.resolve(0));
      const firstMock = vi.fn(() => Promise.resolve({ is_locked: locked ? 1 : 0 }));
      const qb = {
        where: vi.fn().mockReturnThis(),
        update: updateMock,
        select: vi.fn().mockReturnThis(),
        first: firstMock
      };
      const knex = vi.fn().mockReturnValue(qb);
      knex.schema = { hasTable: vi.fn().mockResolvedValue(true) };
      const promise = acquireMigrationLock(knex, { timeoutMs: 1000, intervalMs: 100 });
      const expectPromise = expect(promise).rejects.toThrow(/Timeout acquiring knex_migrations_lock/);
      await vi.advanceTimersByTimeAsync(1100);
      await expectPromise;
      vi.useRealTimers();
    });

    it('blocks concurrent callers until the first lock is released or times out', async () => {
      vi.useFakeTimers();
      let locked = false;
      const updateMock = vi.fn((values) => {
        if (values.is_locked === 1) {
          if (!locked) {
            locked = true;
            return Promise.resolve(1);
          }
          return Promise.resolve(0);
        }
        if (values.is_locked === 0) {
          locked = false;
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      });
      const firstMock = vi.fn(() => Promise.resolve({ is_locked: locked ? 1 : 0 }));
      const qb = {
        where: vi.fn().mockReturnThis(),
        update: updateMock,
        select: vi.fn().mockReturnThis(),
        first: firstMock
      };
      const knex = vi.fn().mockReturnValue(qb);
      knex.schema = { hasTable: vi.fn().mockResolvedValue(true) };

      const lock1 = await acquireMigrationLock(knex);
      const lock2Promise = acquireMigrationLock(knex, { timeoutMs: 1000, intervalMs: 100 });
      const expectPromise = expect(lock2Promise).rejects.toThrow(/Timeout acquiring knex_migrations_lock/);
      await vi.advanceTimersByTimeAsync(1100);
      await expectPromise;
      await lock1.release();
      vi.useRealTimers();
    });
  });
