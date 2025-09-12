import { vi } from 'vitest';

export function createKnexMockRaw(rawImpl = vi.fn(() => Promise.resolve())) {
  const knex = () => ({
    where() { return this; },
    update: async () => 1,
    select() { return this; },
    first: async () => ({ is_locked: 0 }),
  });
  knex.schema = { hasTable: async () => true };
  knex.raw = rawImpl;
  return knex;
}

export function createKnexMock({ rawImpl = vi.fn(() => Promise.resolve()), clientConfig = { database: 'testdb', host: 'localhost', user: 'root' } } = {}) {
  const knex = createKnexMockRaw(rawImpl);
  knex.client = { config: { connection: clientConfig } };
  return knex;
}

export function createKnexMockBuilder({
  toSQL = (name) => ({ sql: `ALTER TABLE ${name} ADD INDEX idx_foo (foo)` }),
  rawImpl,
  clientConfig,
} = {}) {
  const knex = createKnexMock({ rawImpl: rawImpl ?? vi.fn((sql, bindings) => {
    if (bindings !== undefined) {
      return { toQuery: () => sql };
    }
    return Promise.resolve();
  }), clientConfig });
  knex.schema.alterTable = (name, cb) => {
    cb({});
    return { toSQL: () => toSQL(name) };
  };
  return knex;
}

export function createLockKnexMock(initial = 0, opts = {}) {
  const { updateError = null, selectError = null } = opts;
  const state = { is_locked: initial };
  const knex = () => {
    const builder = {
      where() { return builder; },
      update: async (obj) => {
        if (updateError) throw updateError;
        if (obj.is_locked === 1 && state.is_locked === 0) {
          state.is_locked = 1;
          return 1;
        }
        if (obj.is_locked === 0 && state.is_locked === 1) {
          state.is_locked = 0;
          return 1;
        }
        return 0;
      },
      select() { return builder; },
      first: async () => {
        if (selectError) throw selectError;
        return { is_locked: state.is_locked };
      },
    };
    return builder;
  };
  knex.schema = { hasTable: async () => true };
  knex._state = state;
  return knex;
}
