import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKnexMockBuilder } from './helpers/knex-mock.js';

const mocks = vi.hoisted(() => {
  const resolveError = new Error(
    'pt-online-schema-change binary not found: test-binary. Install Percona Toolkit and ensure pt-online-schema-change is in your PATH.'
  );
  const resolvePtoscPath = vi.fn(() => {
    throw resolveError;
  });
  const runPtoscProcess = vi.fn(async () => {
    resolvePtoscPath();
  });
  const buildPtoscArgs = vi.fn(() => []);

  return { resolveError, resolvePtoscPath, runPtoscProcess, buildPtoscArgs };
});

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: mocks.buildPtoscArgs,
  runPtoscProcess: mocks.runPtoscProcess,
  resolvePtoscPath: mocks.resolvePtoscPath,
}));

import { alterTableWithPtosc } from '../src/index.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('alterTableWithPtosc missing binary handling', () => {
  it('surfaces resolvePtoscPath errors from pt-osc runner', async () => {
    const knex = createKnexMockBuilder({
      toSQL: (name) => ({ sql: `ALTER TABLE ${name} ADD COLUMN foo INT` }),
    });

    await expect(
      alterTableWithPtosc(knex, 'widgets', () => {}, { forcePtosc: true })
    ).rejects.toThrow(mocks.resolveError.message);

    expect(mocks.resolvePtoscPath).toHaveBeenCalledTimes(1);
  });
});
