const { exec } = require('child_process');

const VALID_FOREIGN_KEYS_METHODS = ['auto', 'rebuild_constraints', 'drop_swap', 'none'];

function stripBackticks(sql) {
  return sql.replace(/`/g, '');
}

/**
 * Waits for knex_migrations_lock.is_locked to become 0.
 * Throws if timeout exceeded.
 */
async function waitForLockRelease(knex, timeoutMs = 30000, intervalMs = 500) {
  const start = Date.now();
  while (true) {
    const [{ is_locked }] = await knex('knex_migrations_lock').select('is_locked').limit(1);
    if (!is_locked) return; // lock is free
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timeout waiting for knex_migrations_lock to be released');
    }
    await new Promise(res => setTimeout(res, intervalMs));
  }
}

/**
 * Helper to run a function while holding the knex migration lock,
 * waiting for the lock to become free before acquiring it.
 */
async function withMigrationLock(knex, fn) {

  await waitForLockRelease(knex);

  // Lock: set is_locked = 1
  await knex('knex_migrations_lock').update({ is_locked: 1 });

  try {
    await fn();
  } finally {
    // Always unlock
    await knex('knex_migrations_lock').update({ is_locked: 0 });
  }
}

async function alterTableWithPTOSC(knex, table, alterSQL, options = {}) {
  const {
    password,
    maxLoad,
    criticalLoad,
    alterForeignKeysMethod = 'auto',
  } = options;

  if (maxLoad !== undefined && !Number.isInteger(maxLoad)) {
    throw new TypeError(`maxLoad must be an integer, got ${typeof maxLoad}`);
  }
  if (criticalLoad !== undefined && !Number.isInteger(criticalLoad)) {
    throw new TypeError(`criticalLoad must be an integer, got ${typeof criticalLoad}`);
  }
  if (!VALID_FOREIGN_KEYS_METHODS.includes(alterForeignKeysMethod)) {
    throw new TypeError(
      `alterForeignKeysMethod must be one of ${VALID_FOREIGN_KEYS_METHODS.join(', ')} ... got '${alterForeignKeysMethod}' instead.`
    );
  }

  console.log(`[PT-OSC] Starting dry-run for ALTER TABLE ${table} ${alterSQL}`);

  await runPTOSC(
    knex,
    table,
    alterSQL,
    password,
    maxLoad,
    criticalLoad,
    alterForeignKeysMethod,
    true
  );
  console.log(`[PT-OSC] Dry-run successful. Executing...`);
  await runPTOSC(
    knex,
    table,
    alterSQL,
    password,
    maxLoad,
    criticalLoad,
    alterForeignKeysMethod,
    false
  );
}

async function runPTOSC(
  knex,
  table,
  alterSQL,
  password,
  maxLoad,
  criticalLoad,
  alterForeignKeysMethod,
  dryRun
) {
  const conn = knex.client.config.connection;
  const usedPassword = password || conn.password;

  // Skip CREATE TABLE statements
  if (/^\s*CREATE\s+TABLE/i.test(alterSQL)) {
    console.log(`[PT-OSC] Skipping CREATE TABLE for ${table}`);
    return knex.schema.raw(alterSQL); // Let Knex run CREATE directly
  }

  const cleanAlterSQL = stripBackticks(alterSQL);

  const cmdParts = [
    'pt-online-schema-change',
    `--alter "${cleanAlterSQL}"`,
    `--alter-foreign-keys-method=${alterForeignKeysMethod}`,
    `D=${conn.database},t=${table}`,
    dryRun ? '--dry-run' : '--execute',
    `--host=${conn.host}`,
    `--user=${conn.user}`,
  ];

  if (usedPassword) {
    cmdParts.push(`--password='${usedPassword}'`);
  }

  if (maxLoad !== undefined) {
    cmdParts.push(`--max-load="Threads_connected=${maxLoad}"`);
  }

  if (criticalLoad !== undefined) {
    cmdParts.push(`--critical-load="Threads_running=${criticalLoad}"`);
  }

  const cmd = cmdParts.join(' ');

  console.log(`[PT-OSC] Running: ${cmd}`);

  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      console.log(stdout);
      resolve();
    });
  });
}

/**
 * Runs pt-online-schema-change for Knex schema alterTable operations.
 * Throws if no ALTER TABLE statements are generated, i.e. if user calls on CREATE TABLE.
 *
 * @param {object} knex Knex instance
 * @param {string} tableName Table name
 * @param {function} alterCallback Knex schema alterTable callback
 * @param {object} options Plugin options (password, maxLoad, criticalLoad, alterForeignKeysMethod, migrationName)
 */
async function alterTableWithBuilder(knex, tableName, alterCallback, options = {}) {
  const builder = knex.schema.alterTable(tableName, alterCallback);
  const sqlStatements = builder.toSQL();

  // Filter ALTER TABLE statements only
  const alterStatements = sqlStatements
    .map(stmt => stmt.sql)
    .filter(sql => /^ALTER\s+TABLE/i.test(sql.trim()));

  if (alterStatements.length === 0) {
    throw new Error(
      `No ALTER TABLE statements generated for "${tableName}". ` +
      `This plugin supports only ALTER operations. ` +
      `Use knex.schema.createTable(...) for creating new tables.`
    );
  }

  await withMigrationLock(knex, async () => {
    for (const stmt of alterStatements) {
      // Remove "ALTER TABLE `tableName` " prefix to get only the ALTER clause
      const alterClause = stmt.replace(new RegExp(`^ALTER\\s+TABLE\\s+\\S+\\s+`, 'i'), '');
      await alterTableWithPTOSC(knex, tableName, alterClause, options);
    }

    // Insert migration record after successful migration
    const [{ max: maxBatch }] = await knex('knex_migrations').max('batch as max');
    await knex('knex_migrations').insert({
      name: options.migrationName || `ptosc_${Date.now()}`,
      batch: (maxBatch || 0) + 1,
      migration_time: new Date()
    });
  });
}

module.exports = {
  alterTableWithPTOSC,
  alterTableWithBuilder,
};
