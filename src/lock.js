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
  const hasMigrationsTable = await knex.schema.hasTable(migrationsTable);
  const hasLockTable = await knex.schema.hasTable(migrationsLockTable);

  if (!hasMigrationsTable || !hasLockTable) {
    throw new Error(
      'Required Knex migration tables do not exist. ' +
      `Ensure ${migrationsTable} and ${migrationsLockTable} are created before running pt-osc migrations.`
    );
  }

  const start = Date.now();
  let acquired = false;
  let changedRow = false;

  while (!acquired) {
    const updated = await knex(migrationsLockTable)
      .where({ is_locked: 0 })
      .update({ is_locked: 1 })
      .catch(() => 0);

    if (updated === 1) {
      acquired = true;
      changedRow = true;
      break;
    }

    await knex(migrationsLockTable)
      .select('is_locked')
      .first()
      .catch(() => ({ is_locked: 0 }));

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout acquiring ${migrationsLockTable}`);
    }
    await sleep(intervalMs);
  }

  return {
    release: async () => {
      if (!acquired || !changedRow) return;
      await knex(migrationsLockTable)
        .where({ is_locked: 1 })
        .update({ is_locked: 0 })
        .catch((err) => {
          logger.error('Failed to release migration lock', err);
          throw err;
        });
    },
  };
}
