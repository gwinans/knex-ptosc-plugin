import { describe, it, expect, vi } from 'vitest';
import childProcess from 'child_process';
import { buildPtoscArgs, resolvePtoscPath } from '../src/ptosc-runner.js';

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
    expect(() => resolvePtoscPath('missing-ptosc')).toThrow(
      /binary not found: missing-ptosc/
    );
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    spawnSpy.mockRestore();
  });
});
