import Knex from 'knex';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Acquire knex's migration lock atomically.
 * Will only update the lock row from 0 -> 1. Retries until timeout.
 * Returns a release() function that sets 1 -> 0 if we acquired it.
 * If required tables don't exist, throw immediately.
 */
export async function acquireMigrationLock(
  knex,
  {
    migrationsTable = 'knex_migrations',
    migrationsLockTable = 'knex_migrations_lock',
    timeoutMs = 30000,
    intervalMs = 500,
    logger = console,
  } = {},
) {
  let rootKnex;
  let runner = knex;
  try {
    if (knex.isTransaction) {
      rootKnex = Knex(knex.client.config);
      runner = rootKnex;
    }

    const [hasMigrationsTable, hasLockTable] = await Promise.all([
      runner.schema.hasTable(migrationsTable),
      runner.schema.hasTable(migrationsLockTable),
    ]);

    if (!hasMigrationsTable || !hasLockTable) {
      throw new Error(
        'Required Knex migration tables do not exist. ' +
        `Ensure ${migrationsTable} and ${migrationsLockTable} are created before running pt-osc migrations.`
      );
    }

    const start = Date.now();
    let changedRow = false;

    while (Date.now() - start <= timeoutMs) {
      const updated = await runner(migrationsLockTable)
        .where({ is_locked: 0 })
        .update({ is_locked: 1 })
        .catch(() => 0);

      if (updated === 1) {
        changedRow = true;
        break;
      }

      await sleep(intervalMs);
    }

    if (!changedRow) {
      const lockRow = await runner(migrationsLockTable)
        .select('is_locked')
        .first()
        .catch(() => ({ is_locked: 0 }));

      if (lockRow.is_locked === 1) {
        throw new Error(`Timeout acquiring ${migrationsLockTable}`);
      }
    }

    return {
      release: async () => {
        if (!changedRow) {
          if (rootKnex) await rootKnex.destroy();
          return;
        }
        try {
          await runner(migrationsLockTable)
            .where({ is_locked: 1 })
            .update({ is_locked: 0 });
        } catch (err) {
          logger.error('Failed to release migration lock', err);
          throw err;
        } finally {
          if (rootKnex) await rootKnex.destroy();
        }
      },
    };
  } catch (err) {
    if (rootKnex) await rootKnex.destroy();
    throw err;
  }
}
