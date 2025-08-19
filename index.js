import childProcess from 'child_process';

const VALID_FOREIGN_KEYS_METHODS = ['auto', 'rebuild_constraints', 'drop_swap', 'none'];

/** Small helper */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Acquire knex's migration lock atomically.
 * Will only update the lock row from 0 -> 1. Retries until timeout.
 * Returns a release() function that sets 1 -> 0 if we acquired it.
 * If required tables don't exist, throw immediately.
 */
async function acquireMigrationLock(
  knex,
  {
    migrationsTable = 'knex_migrations',
    migrationsLockTable = 'knex_migrations_lock',
    timeoutMs = 30000,
    intervalMs = 500,
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

  while (!acquired) {
    const updated = await knex(migrationsLockTable)
      .where({ is_locked: 0 })
      .update({ is_locked: 1 })
      .catch(() => 0);

    if (updated === 1) {
      acquired = true;
      break;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout acquiring ${migrationsLockTable}`);
    }
    await sleep(intervalMs);
  }

  return {
    release: async () => {
      if (!acquired) return;
      await knex(migrationsLockTable)
        .where({ is_locked: 1 })
        .update({ is_locked: 0 })
        .catch(() => {});
    },
  };
}

/** Build pt-osc args array (no shell quoting) */
function buildPtoscArgs({
  alterSQL,
  database,
  table,
  alterForeignKeysMethod,
  host,
  user,
  port,
  socketPath,
  maxLoad,
  maxLoadMetric = 'Threads_running',
  criticalLoad,
  criticalLoadMetric = 'Threads_running',
  dryRun,
  analyzeBeforeSwap = true,
  checkAlter = true,
  checkForeignKeys = true,
  checkInterval,
  checkPlan = true,
  checkReplicationFilters = true,
  checkReplicaLag = false,
  chunkIndex,
  chunkIndexColumns,
  chunkSize = 1000,
  chunkSizeLimit = 4.0,
  chunkTime = 0.5,
  dropNewTable = true,
  dropOldTable = true,
  dropTriggers = true,
  checkUniqueKeyChange = true,
  maxLag = 25
}) {
  const args = [
    '--alter', alterSQL,
    `--alter-foreign-keys-method=${alterForeignKeysMethod}`,
    `D=${database},t=${table}`,
    dryRun ? '--dry-run' : '--execute',
    `--host=${host}`,
    `--user=${user}`,
  ];
  if (port != null) args.push('--port', String(port));
  if (socketPath) args.push('--socket', socketPath);
  if (maxLoad != null) args.push('--max-load', `${maxLoadMetric}=${maxLoad}`);
  if (criticalLoad != null) args.push('--critical-load', `${criticalLoadMetric}=${criticalLoad}`);
  args.push(analyzeBeforeSwap ? '--analyze-before-swap' : '--noanalyze-before-swap');
  args.push(checkAlter ? '--check-alter' : '--nocheck-alter');
  args.push(checkForeignKeys ? '--check-foreign-keys' : '--nocheck-foreign-keys');
  if (checkInterval != null) args.push('--check-interval', String(checkInterval));
  args.push(checkPlan ? '--check-plan' : '--nocheck-plan');
  args.push(checkReplicationFilters ? '--check-replication-filters' : '--nocheck-replication-filters');
  if (checkReplicaLag) args.push('--check-replica-lag');
  if (chunkIndex) args.push('--chunk-index', chunkIndex);
  if (chunkIndexColumns != null) args.push('--chunk-index-columns', String(chunkIndexColumns));
  if (chunkSize != null) args.push('--chunk-size', String(chunkSize));
  if (chunkSizeLimit != null) args.push('--chunk-size-limit', String(chunkSizeLimit));
  if (chunkTime != null) args.push('--chunk-time', String(chunkTime));
  args.push(dropNewTable ? '--drop-new-table' : '--nodrop-new-table');
  args.push(dropOldTable ? '--drop-old-table' : '--nodrop-old-table');
  args.push(dropTriggers ? '--drop-triggers' : '--nodrop-triggers');
  args.push(checkUniqueKeyChange ? '--check-unique-key-change' : '--nocheck-unique-key-change');
  if (maxLag != null) args.push('--max-lag', String(maxLag));
  return args;
}

function logCommand(ptoscPath, args, logger = console) {
  const printable = [ptoscPath, ...args.map(a => (/\s/.test(a) ? `"${a}"` : a))].join(' ');
  logger.log(`[PT-OSC] Running: ${printable}`);
}

/** Low-level runner (no shell; password via env) */
async function runPtoscProcess({
  ptoscPath = 'pt-online-schema-change',
  args,
  envPassword,
  logger = console,
  maxBuffer = 10 * 1024 * 1024,
}) {
  const env = { ...process.env };
  if (envPassword) env.MYSQL_PWD = String(envPassword);

  logCommand(ptoscPath, args, logger);

  await new Promise((resolve, reject) => {
    childProcess.execFile(ptoscPath, args, { env, maxBuffer }, (err, stdout = '', stderr = '') => {
      if (stdout) logger.log(stdout);
      if (stderr) logger.error(stderr);
      if (err) {
        logger.error(`pt-online-schema-change failed with code ${err.code}`);
        const error = new Error(err.message || 'pt-online-schema-change failed');
        error.code = err.code;
        error.stdout = stdout;
        error.stderr = stderr;
        return reject(error);
      }
      resolve();
    });
  });
}

/**
 * INTERNAL ONLY: run pt-osc for one ALTER clause (no CREATE handling here).
 * Not exported to avoid any public raw-SQL entrypoint.
 */
async function runAlterClauseWithPtosc(knex, table, alterClause, options = {}) {
  const {
    password,
    maxLoad,
    maxLoadMetric,
    criticalLoad,
    criticalLoadMetric,
    alterForeignKeysMethod = 'auto',
    ptoscPath,
    analyzeBeforeSwap = true,
    checkAlter = true,
    checkForeignKeys = true,
    checkInterval,
    checkPlan = true,
    checkReplicationFilters = true,
    checkReplicaLag = false,
    chunkIndex,
    chunkIndexColumns,
    chunkSize = 1000,
    chunkSizeLimit = 4.0,
    chunkTime = 0.5,
    dropNewTable = true,
    dropOldTable = true,
    dropTriggers = true,
    checkUniqueKeyChange = true,
    maxLag = 25,
    maxBuffer,
    logger = console
  } = options;

  if (maxLoad !== undefined && (!Number.isInteger(maxLoad) || maxLoad <= 0)) {
    throw new TypeError(`maxLoad must be a positive integer, got ${maxLoad}`);
  }
  if (criticalLoad !== undefined && (!Number.isInteger(criticalLoad) || criticalLoad <= 0)) {
    throw new TypeError(`criticalLoad must be a positive integer, got ${criticalLoad}`);
  }
  if (checkInterval !== undefined && (!Number.isInteger(checkInterval) || checkInterval <= 0)) {
    throw new TypeError(`checkInterval must be a positive integer, got ${checkInterval}`);
  }
  if (chunkIndexColumns !== undefined && (!Number.isInteger(chunkIndexColumns) || chunkIndexColumns <= 0)) {
    throw new TypeError(`chunkIndexColumns must be a positive integer, got ${chunkIndexColumns}`);
  }
  if (chunkSize !== undefined && (!Number.isInteger(chunkSize) || chunkSize <= 0)) {
    throw new TypeError(`chunkSize must be a positive integer, got ${chunkSize}`);
  }
  if (chunkSizeLimit !== undefined && (typeof chunkSizeLimit !== 'number' || chunkSizeLimit <= 0)) {
    throw new TypeError(`chunkSizeLimit must be a positive number, got ${chunkSizeLimit}`);
  }
  if (chunkTime !== undefined && (typeof chunkTime !== 'number' || chunkTime <= 0)) {
    throw new TypeError(`chunkTime must be a positive number, got ${chunkTime}`);
  }
  if (maxLag !== undefined && (!Number.isInteger(maxLag) || maxLag <= 0)) {
    throw new TypeError(`maxLag must be a positive integer, got ${maxLag}`);
  }
  if (maxBuffer !== undefined && (!Number.isInteger(maxBuffer) || maxBuffer <= 0)) {
    throw new TypeError(`maxBuffer must be a positive integer, got ${maxBuffer}`);
  }
  if (!VALID_FOREIGN_KEYS_METHODS.includes(alterForeignKeysMethod)) {
    throw new TypeError(
      `alterForeignKeysMethod must be one of ${VALID_FOREIGN_KEYS_METHODS.join(', ')}; got '${alterForeignKeysMethod}'.`
    );
  }

  const conn = knex.client.config.connection || {};
  const usedPassword = password ?? conn.password;

  // Dry-run
  logger.log(`[PT-OSC] Dry-run for ALTER TABLE ${table} ${alterClause}`);
  await runPtoscProcess({
    ptoscPath,
    args: buildPtoscArgs({
      alterSQL: alterClause,
      database: conn.database,
      table,
      alterForeignKeysMethod,
      host: conn.host || 'localhost',
      user: conn.user,
      port: conn.port,
      socketPath: conn.socketPath,
      maxLoad,
      maxLoadMetric,
      criticalLoad,
      criticalLoadMetric,
      dryRun: true,
      analyzeBeforeSwap,
      checkAlter,
      checkForeignKeys,
      checkInterval,
      checkPlan,
      checkReplicationFilters,
      checkReplicaLag,
      chunkIndex,
      chunkIndexColumns,
      chunkSize,
      chunkSizeLimit,
      chunkTime,
      dropNewTable,
      dropOldTable,
      dropTriggers,
      checkUniqueKeyChange,
      maxLag
    }),
      envPassword: usedPassword,
      logger,
      maxBuffer
    });

  // Execute
  logger.log(`[PT-OSC] Dry-run successful. Executing ALTER TABLE ${table} ${alterClause}`);
  await runPtoscProcess({
    ptoscPath,
    args: buildPtoscArgs({
      alterSQL: alterClause,
      database: conn.database,
      table,
      alterForeignKeysMethod,
      host: conn.host || 'localhost',
      user: conn.user,
      port: conn.port,
      socketPath: conn.socketPath,
      maxLoad,
      maxLoadMetric,
      criticalLoad,
      criticalLoadMetric,
      dryRun: false,
      analyzeBeforeSwap,
      checkAlter,
      checkForeignKeys,
      checkInterval,
      checkPlan,
      checkReplicationFilters,
      checkReplicaLag,
      chunkIndex,
      chunkIndexColumns,
      chunkSize,
      chunkSizeLimit,
      chunkTime,
      dropNewTable,
      dropOldTable,
      dropTriggers,
      checkUniqueKeyChange,
      maxLag
    }),
      envPassword: usedPassword,
      logger,
      maxBuffer
    });
  }

/**
 * Public API: ONLY the Knex builder path.
 * Compiles the alterTable callback, extracts ALTER statements, applies bindings,
 * and runs each via pt-osc under the migration lock.
 */
export async function alterTableWithBuilder(knex, tableName, alterCallback, options = {}) {
  const builder = knex.schema.alterTable(tableName, alterCallback);
  const compiled = builder.toSQL();
  const stmts = Array.isArray(compiled) ? compiled : [compiled];

  // Resolve bindings into full SQL strings
  const sqls = stmts.map(s => {
    const sql = s.sql ?? s;
    const bindings = s.bindings ?? [];
    return knex.raw(sql, bindings).toQuery();
  });

  // Only keep ALTER TABLE statements
  const alterStatements = sqls
    .map(sql => String(sql).trim())
    .filter(sql => /^ALTER\s+TABLE\b/i.test(sql));

  if (alterStatements.length === 0) {
    throw new Error(
      `No ALTER TABLE statements generated for "${tableName}". ` +
      `Only ALTER operations are supported. Use knex.schema.createTable(...) to create tables.`
    );
  }

  const { release } = await acquireMigrationLock(knex, options);
  try {
    for (const fullAlter of alterStatements) {
      // Extract the clause after: ALTER TABLE <name> <CLAUSE>
      const m = fullAlter.match(/^ALTER\s+TABLE\s+(`?(?:[^`.\s]+`?\.)?`?[^`\s]+`?)\s+(.*)$/i);
      const clause = m ? m[2] : fullAlter.replace(/^ALTER\s+TABLE\s+\S+\s+/i, '');
      await runAlterClauseWithPtosc(knex, tableName, clause, options);
    }
  } finally {
    await release();
  }
}
