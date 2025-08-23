import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import child from 'child_process';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';

let runPtoscProcess;
let spawnSyncSpy;
let spawnSpy;

beforeEach(async () => {
  vi.resetModules();
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
  ({ runPtoscProcess } = await import('../src/ptosc-runner.js'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolvePtoscPath caching', () => {
  it('calls spawnSync once for repeated ptoscPath', async () => {
    await runPtoscProcess({ ptoscPath: 'pt-online-schema-change', args: [] });
    await runPtoscProcess({ ptoscPath: 'pt-online-schema-change', args: [] });
    expect(spawnSyncSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy).toHaveBeenCalledTimes(2);
  });
});
