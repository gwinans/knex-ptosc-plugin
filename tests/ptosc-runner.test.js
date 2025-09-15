import { describe, it, expect, vi } from 'vitest';
import childProcess from 'child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  buildPtoscArgs,
  resolvePtoscPath,
  runPtoscProcess,
} from '../src/ptosc-runner.js';

describe('buildPtoscArgs', () => {
  it('translates options into pt-osc arguments', () => {
    const args = buildPtoscArgs({
      alterSQL: 'ADD COLUMN foo INT',
      database: 'testdb',
      table: 'testtable',
      alterForeignKeysMethod: 'auto',
      host: 'localhost',
      user: 'root',
      port: 3306,
      socketPath: '/tmp/mysql.sock',
      maxLoad: 100,
      criticalLoad: 200,
      dryRun: true,
      analyzeBeforeSwap: false,
      checkAlter: false,
      checkForeignKeys: false,
      checkInterval: 5,
      checkPlan: false,
      checkReplicationFilters: false,
      checkReplicaLag: true,
      chunkIndex: 'id',
      chunkIndexColumns: 2,
      chunkSize: 500,
      chunkSizeLimit: 3.5,
      chunkTime: 1,
      dropNewTable: false,
      dropOldTable: false,
      dropTriggers: false,
      checkUniqueKeyChange: false,
      maxLag: 10,
      statistics: true,
    });
    expect(args).toEqual([
      '--alter', 'ADD COLUMN foo INT',
      '--alter-foreign-keys-method=auto',
      'D=testdb,t=testtable',
      '--dry-run',
      '--host=localhost',
      '--user=root',
      '--port', '3306',
      '--socket', '/tmp/mysql.sock',
      '--max-load', 'Threads_running=100',
      '--critical-load', 'Threads_running=200',
      '--noanalyze-before-swap',
      '--nocheck-alter',
      '--nocheck-foreign-keys',
      '--check-interval', '5',
      '--nocheck-plan',
      '--nocheck-replication-filters',
      '--check-replica-lag',
      '--chunk-index', 'id',
      '--chunk-index-columns', '2',
      '--chunk-size', '500',
      '--chunk-size-limit', '3.5',
      '--chunk-time', '1',
      '--nodrop-new-table',
      '--nodrop-old-table',
      '--nodrop-triggers',
      '--nocheck-unique-key-change',
      '--max-lag', '10',
      '--statistics',
    ]);
  });
});

describe('resolvePtoscPath', () => {
  it('caches resolved path to avoid repeated spawnSync calls', () => {
    const spawnSpy = vi
      .spyOn(childProcess, 'spawnSync')
      .mockReturnValue({
        status: 0,
        stdout: Buffer.from('/usr/bin/pt-online-schema-change\n'),
      });
    const first = resolvePtoscPath('cached-ptosc');
    const second = resolvePtoscPath('cached-ptosc');
    expect(first).toBe('/usr/bin/pt-online-schema-change');
    expect(second).toBe('/usr/bin/pt-online-schema-change');
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    spawnSpy.mockRestore();
  });

  it('throws an error when spawnSync status is non-zero', () => {
    const spawnSpy = vi
      .spyOn(childProcess, 'spawnSync')
      .mockReturnValue({ status: 1, stdout: Buffer.from('') });
    let error;
    try {
      resolvePtoscPath('missing-ptosc');
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
    expect(error.message).toMatch(/binary not found: missing-ptosc/);
    expect(error.message).not.toContain('\n');
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    spawnSpy.mockRestore();
  });
});

describe('runPtoscProcess', () => {
  it('reports progress and statistics', async () => {
    const spawnSyncSpy = vi
      .spyOn(childProcess, 'spawnSync')
      .mockReturnValue({ status: 0, stdout: Buffer.from('/usr/bin/ptosc\n') });
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = vi.fn();
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockReturnValue(child);

    const onProgress = vi.fn();
    const onStatistics = vi.fn();
    const promise = runPtoscProcess({
      ptoscPath: 'progress-ptosc',
      args: [],
      onProgress,
      onStatistics,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    stdout.write('50% 00:20 remain\n');
    stderr.write('# Copy time 2\n');
    stdout.write('# Chunk time 1.5\n');
    stdout.end();
    stderr.end();
    child.emit('close', 0);

    const result = await promise;
    expect(onProgress).toHaveBeenCalledWith(50, '00:20');
    expect(result.statistics).toEqual({ 'Copy time': 2, 'Chunk time': 1.5 });
    expect(onStatistics).toHaveBeenCalledWith({
      'Copy time': 2,
      'Chunk time': 1.5,
    });

    spawnSpy.mockRestore();
    spawnSyncSpy.mockRestore();
  });

  it('rejects when output exceeds maxBuffer', async () => {
    const spawnSyncSpy = vi
      .spyOn(childProcess, 'spawnSync')
      .mockReturnValue({ status: 0, stdout: Buffer.from('/usr/bin/ptosc\n') });
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = vi.fn();
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockReturnValue(child);

    const promise = runPtoscProcess({
      ptoscPath: 'buffer-ptosc',
      args: [],
      maxBuffer: 10,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    stdout.write('a'.repeat(11));
    stdout.end();
    stderr.end();
    await expect(promise).rejects.toThrow(/maxBuffer exceeded/);
    expect(child.kill).toHaveBeenCalled();

    spawnSpy.mockRestore();
    spawnSyncSpy.mockRestore();
  });

  it('propagates non-zero exit code with captured logs', async () => {
    const spawnSyncSpy = vi
      .spyOn(childProcess, 'spawnSync')
      .mockReturnValue({ status: 0, stdout: Buffer.from('/usr/bin/ptosc\n') });
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = vi.fn();
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockReturnValue(child);

    const promise = runPtoscProcess({
      ptoscPath: 'exit-ptosc',
      args: [],
      logger: { log: vi.fn(), error: vi.fn() },
    });

    stdout.write('out\n');
    stderr.write('err\n');
    stdout.end();
    stderr.end();
    child.emit('close', 1);

    await expect(promise).rejects.toMatchObject({
      code: 1,
      stdout: 'out\n',
      stderr: 'err\n',
    });

    spawnSpy.mockRestore();
    spawnSyncSpy.mockRestore();
  });
});
