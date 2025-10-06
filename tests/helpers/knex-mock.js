import { vi } from 'vitest';

export function createKnexMockRaw(rawImpl = vi.fn(() => Promise.resolve())) {
  const knex = createLockKnexMock(0);
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
  const {
    updateError = null,
    selectError = null,
    externalLock = initial === 1,
  } = opts;

  const state = {
    is_locked: initial,
    selectCalls: 0,
    updateCalls: 0,
    lockOwner: externalLock ? 'external' : null,
    waiters: [],
  };

  const createBuilder = (context = {}) => {
    let forUpdate = false;
    let expectedIsLocked;

    const builder = {
      where(condition, value) {
        if (typeof condition === 'object' && condition !== null) {
          if (Object.prototype.hasOwnProperty.call(condition, 'is_locked')) {
            expectedIsLocked = condition.is_locked;
          }
        } else if (condition === 'is_locked' && value !== undefined) {
          expectedIsLocked = value;
        }
        return builder;
      },
      forUpdate() {
        forUpdate = true;
        return builder;
      },
      select() {
        return builder;
      },
      first: async () => {
        state.selectCalls += 1;
        if (selectError) throw selectError;

        if (context.trx && forUpdate) {
          await context.trx.acquireLock();
        }

        return { is_locked: state.is_locked };
      },
      update: async (obj) => {
        state.updateCalls += 1;
        if (updateError) throw updateError;

        if (context.trx) {
          if (!context.trx.active) {
            throw new Error('Transaction already completed');
          }
          if (state.lockOwner !== context.trx) {
            throw new Error('Cannot update lock without owning it');
          }
        }

        if (Object.prototype.hasOwnProperty.call(obj, 'is_locked')) {
          if (expectedIsLocked !== undefined && state.is_locked !== expectedIsLocked) {
            expectedIsLocked = undefined;
            return 0;
          }
          expectedIsLocked = undefined;
          state.is_locked = obj.is_locked;
          return 1;
        }

        expectedIsLocked = undefined;
        return 0;
      },
    };

    return builder;
  };

  const removeWaitersFor = (trx) => {
    state.waiters = state.waiters.filter((waiter) => {
      if (waiter.trx === trx) {
        waiter.resolve();
        return false;
      }
      return true;
    });
  };

  const releaseLockToNext = () => {
    while (state.waiters.length > 0) {
      const next = state.waiters.shift();
      if (!next.trx.active) {
        next.resolve();
        continue;
      }
      state.lockOwner = next.trx;
      next.resolve();
      return;
    }
    state.lockOwner = null;
  };

  const knex = () => createBuilder();
  knex.schema = { hasTable: async () => true };
  knex._state = state;

  knex.transaction = async () => {
    const trx = () => createBuilder({ trx });
    trx.active = true;
    trx.beforeState = state.is_locked;

    trx.acquireLock = async () => {
      if (!trx.active) throw new Error('Transaction completed');

      if (state.lockOwner === trx) return;

      if (state.lockOwner === null) {
        state.lockOwner = trx;
        return;
      }

      const waiter = { trx };
      const promise = new Promise((resolve) => {
        waiter.resolve = resolve;
      });
      state.waiters.push(waiter);
      await promise;

      if (!trx.active) {
        throw new Error('Transaction aborted while waiting for lock');
      }

      if (state.lockOwner !== trx) {
        throw new Error('Failed to obtain migration lock');
      }
    };

    const finalize = () => {
      removeWaitersFor(trx);

      if (state.lockOwner === trx) {
        releaseLockToNext();
      }
    };

    trx.commit = async () => {
      if (!trx.active) return;
      trx.active = false;
      finalize();
    };

    trx.rollback = async () => {
      if (!trx.active) return;
      trx.active = false;
      state.is_locked = trx.beforeState;
      finalize();
    };

    return trx;
  };

  state.releaseExternalLock = () => {
    if (state.lockOwner === 'external') {
      state.lockOwner = null;
      releaseLockToNext();
    }
  };

  return knex;
}
