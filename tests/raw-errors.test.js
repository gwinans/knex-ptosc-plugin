import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKnexMockRaw, createKnexMockBuilder } from './helpers/knex-mock.js';

vi.mock('../src/ptosc-runner.js', () => ({
  buildPtoscArgs: vi.fn(() => []),
  runPtoscProcess: vi.fn(() => Promise.resolve({ statistics: {} })),
}));

import { alterTableWithPtoscRaw, alterTableWithPtosc } from '../src/index.js';

beforeEach(() => {
  vi.clearAllMocks();
});


describe('input validation', () => {
  it('throws when no SQL statements are provided to alterTableWithPtoscRaw', async () => {
    const knex = createKnexMockRaw();
    await expect(alterTableWithPtoscRaw(knex)).rejects.toThrow('No SQL statements provided.');
  });

  it('throws when a non-ALTER statement is provided to alterTableWithPtoscRaw', async () => {
    const knex = createKnexMockRaw();
    await expect(alterTableWithPtoscRaw(knex, 'DROP TABLE widgets')).rejects.toThrow(
      'Only ALTER TABLE statements are supported: DROP TABLE widgets'
    );
  });

  it('throws when alterTableWithPtosc produces no ALTER clauses', async () => {
    const knex = createKnexMockBuilder({ toSQL: (name) => ({ sql: `CREATE TABLE ${name} (id int)` }) });
    await expect(
      alterTableWithPtosc(knex, 'widgets', () => {})
    ).rejects.toThrow(/No ALTER TABLE statements generated/);
  });

  it('throws when an ALTER TABLE statement cannot be parsed', async () => {
    const knex = createKnexMockRaw();
    await expect(
      alterTableWithPtoscRaw(knex, 'ALTER TABLE')
    ).rejects.toThrow('Unable to parse ALTER TABLE statement: ALTER TABLE');
  });

  it('throws when alterForeignKeysMethod option is invalid', async () => {
    const knex = createKnexMockRaw(
      vi.fn((sql) => {
        if (/SELECT\s+VERSION\(\)\s+AS\s+version/i.test(sql)) {
          return Promise.resolve([{ version: '5.7.0' }]);
        }
        return Promise.resolve();
      })
    );
    await expect(
      alterTableWithPtoscRaw(
        knex,
        'ALTER TABLE widgets ADD COLUMN foo INT',
        { alterForeignKeysMethod: 'invalid' }
      )
    ).rejects.toThrow(
      "alterForeignKeysMethod must be one of auto, rebuild_constraints, drop_swap, none; got 'invalid'."
    );
  });
});
