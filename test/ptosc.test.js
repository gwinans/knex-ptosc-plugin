import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child from 'child_process';
import { alterTableWithPTOSC, alterTableWithBuilder } from '../index.js';

describe('knex-ptosc-plugin', () => {
  let execFileSpy;

  beforeEach(() => {
    execFileSpy = vi.spyOn(child, 'execFile').mockImplementation((cmd, args, opts, cb) => {
      // Pretend pt-osc succeeds for both dry-run and execute
      cb(null, 'ok', '');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes --alter as a separate arg (no shell quoting)', async () => {
    const knex = {
      client: { config: { connection: { database: 'db', host: 'localhost', user: 'root' } } },
      schema: { raw: vi.fn() }
    };

    await alterTableWithPTOSC(knex, 'users', 'ADD COLUMN `age` INT', {});
    expect(execFileSpy).toHaveBeenCalled();
    const args = execFileSpy.mock.calls[0][1];
    expect(args[0]).toBe('--alter');
    expect(args[1]).toContain('ADD COLUMN `age` INT');
  });

  it('extracts ALTER clause from builder SQL and runs twice (dry + exec)', async () => {
    const knex = {
      client: { config: { connection: { database: 'db', host: 'localhost', user: 'root' } } },
      raw: (sql, bindings) => ({ toQuery: () => sql }), // simple passthrough for test
      schema: {
        hasTable: vi.fn().mockResolvedValue(true),
        alterTable: vi.fn((_name, _cb) => ({
          toSQL: () => [{ sql: 'ALTER TABLE `users` ADD COLUMN `age` INT', bindings: [] }]
        }))
      },
      // emulate knex(...).where().update()
      // lock table behavior
      async schema_hasTable() { return true; },
      async from() { return this; },
      async where() { return this; },
      async update() { return 1; },
      async select() { return [{ is_locked: 0 }]; }
    };

    // Patch methods used by acquireMigrationLock
    knex.schema.hasTable = vi.fn().mockResolvedValue(true);
    const tableFn = vi.fn().mockReturnValue(knex);
    knex['knex_migrations_lock'] = tableFn;
    const q = vi.fn().mockReturnValue(1);
    knex.update = q;
    knex.where = vi.fn().mockReturnValue(knex);

    await alterTableWithBuilder(knex, 'users', (t) => { t.string('age'); }, {});
    expect(execFileSpy).toHaveBeenCalledTimes(2); // dry-run + execute
  });
});
