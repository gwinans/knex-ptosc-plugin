import { describe, it, expect, afterEach } from 'vitest';
import { isDebugEnabled } from '../src/debug.js';

const originalDebug = process.env.DEBUG;

afterEach(() => {
  process.env.DEBUG = originalDebug;
});

describe('isDebugEnabled', () => {
  it('returns false when DEBUG is empty', () => {
    delete process.env.DEBUG;
    expect(isDebugEnabled()).toBe(false);
  });

  it('returns false when DEBUG has unrelated names', () => {
    process.env.DEBUG = 'other-plugin,another';
    expect(isDebugEnabled()).toBe(false);
  });

  it('returns true when DEBUG includes knex-ptosc-plugin', () => {
    process.env.DEBUG = 'other knex-ptosc-plugin extra';
    expect(isDebugEnabled()).toBe(true);
  });
});

