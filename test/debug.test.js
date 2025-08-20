import { describe, it, expect, afterEach } from 'vitest';
import { isDebugEnabled } from '../src/debug.js';

const original = process.env.DEBUG;

afterEach(() => {
  process.env.DEBUG = original;
});

describe('isDebugEnabled', () => {
  it('matches exact name', () => {
    process.env.DEBUG = 'knex-ptosc-plugin';
    expect(isDebugEnabled()).toBe(true);
  });

  it('rejects non-matching names', () => {
    process.env.DEBUG = 'other,foo';
    expect(isDebugEnabled()).toBe(false);
  });
});
