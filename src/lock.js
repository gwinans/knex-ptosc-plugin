/**
 * Acquire knex's migration lock atomically.
 * Acquires the lock row inside a transaction using a database level lock.
 * Returns a release() function that sets 1 -> 0 and commits/rollbacks the transaction.
 * If required tables don't exist, throw immediately.
 */
export async function acquireMigrationLock(
  knex,
  {
    migrationsTable = 'knex_migrations',
    migrationsLockTable = 'knex_migrations_lock',
    timeoutMs = 30000,
    logger = console,
  } = {},
) {
  const [hasMigrationsTable, hasLockTable] = await Promise.all([
    knex.schema.hasTable(migrationsTable),
    knex.schema.hasTable(migrationsLockTable),
  ]);

  if (!hasMigrationsTable || !hasLockTable) {
    throw new Error(
      'Required Knex migration tables do not exist. ' +
      `Ensure ${migrationsTable} and ${migrationsLockTable} are created before running pt-osc migrations.`
    );
  }

  const start = Date.now();
  const deadline = start + timeoutMs;

  const withDeadline = async (promise) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timeout acquiring ${migrationsLockTable}`);
    }

    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Timeout acquiring ${migrationsLockTable}`)),
            remaining,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const trx = await knex.transaction();
  let released = false;

  const rollbackTransaction = async (error) => {
    try {
      await trx.rollback();
    } catch (rollbackErr) {
      logger.error('Failed to rollback migration lock transaction', rollbackErr);
      if (!error) {
        throw rollbackErr;
      }
    }
    if (error) {
      throw error;
    }
  };

  const release = async ({ rollback: shouldRollback = false } = {}) => {
    if (released) return;
    released = true;

    if (shouldRollback) {
      await rollbackTransaction();
      return;
    }

    try {
      await trx(migrationsLockTable)
        .update({ is_locked: 0 });
    } catch (err) {
      logger.error('Failed to release migration lock', err);
      await rollbackTransaction(err);
      return;
    }

    try {
      await trx.commit();
    } catch (err) {
      logger.error('Failed to finalize migration lock transaction', err);
      await rollbackTransaction(err);
    }
  };

  try {
    const row = await withDeadline(
      trx(migrationsLockTable)
        .forUpdate()
        .select('is_locked')
        .first()
        .catch((err) => {
          logger.error('Failed to read migration lock status', err);
          throw err;
        }),
    );

    if (!row) {
      throw new Error(`Missing row in ${migrationsLockTable}`);
    }

    if (row.is_locked) {
      throw new Error(`Migration lock already held in ${migrationsLockTable}`);
    }

    let updated;
    try {
      updated = await trx(migrationsLockTable)
        .where({ is_locked: 0 })
        .update({ is_locked: 1 });
    } catch (err) {
      logger.error('Failed to acquire migration lock', err);
      throw err;
    }

    if (!updated) {
      const err = new Error(`Failed to acquire migration lock from ${migrationsLockTable}`);
      logger.error('Failed to acquire migration lock', err);
      throw err;
    }

    return { release };
  } catch (err) {
    released = true;
    try {
      await trx.rollback();
    } catch (rollbackErr) {
      logger.error('Failed to rollback migration lock transaction', rollbackErr);
    }
    throw err;
  }
}
