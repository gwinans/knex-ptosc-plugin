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

describe('progress parsing', () => {
  it('handles progress lines from stdout and stderr', async () => {
    const onProgress = vi.fn();
    spawnSpy.mockImplementationOnce(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const proc = new EventEmitter();
      proc.stdout = stdout;
      proc.stderr = stderr;
      setImmediate(() => {
        stdout.emit('data', 'Progress: 10% 00:02 remain');
        stderr.emit('data', 'Progress: 20% 00:01 remain');
        stdout.end();
        stderr.end();
        proc.emit('close', 0);
      });
      return proc;
    });
    await runPtoscProcess({ args: [], onProgress });
    expect(onProgress).toHaveBeenCalledWith(10, '00:02');
    expect(onProgress).toHaveBeenCalledWith(20, '00:01');
  });
});

describe('statistics streaming', () => {
  it('invokes onStatistics for each stats line', async () => {
    const onStatistics = vi.fn();
    spawnSpy.mockImplementationOnce(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const proc = new EventEmitter();
      proc.stdout = stdout;
      proc.stderr = stderr;
      setImmediate(() => {
        stdout.emit('data', '# one 1\n');
        stdout.emit('data', '# two 2\n');
        stdout.emit('data', '# three 3\n');
        stdout.end();
        stderr.end();
        proc.emit('close', 0);
      });
      return proc;
    });
    const { statistics } = await runPtoscProcess({ args: [], onStatistics });
    expect(onStatistics).toHaveBeenCalledTimes(3);
    expect(onStatistics).toHaveBeenNthCalledWith(1, { one: 1 });
    expect(onStatistics).toHaveBeenNthCalledWith(2, { one: 1, two: 2 });
    expect(onStatistics).toHaveBeenNthCalledWith(3, { one: 1, two: 2, three: 3 });
    expect(statistics).toEqual({ one: 1, two: 2, three: 3 });
  });
});

describe('logger validation', () => {
  it('throws when logger.log is not a function', async () => {
    await expect(
      runPtoscProcess({ args: [], logger: { log: true, error: () => {} } })
    ).rejects.toThrow(/logger\.log must be a function/);
    expect(spawnSyncSpy).not.toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('throws when logger.error is not a function', async () => {
    await expect(
      runPtoscProcess({ args: [], logger: { log: () => {}, error: true } })
    ).rejects.toThrow(/logger\.error must be a function/);
    expect(spawnSyncSpy).not.toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});
