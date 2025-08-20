import { acquireMigrationLock } from './lock.js';
import { buildPtoscArgs, runPtoscProcess } from './ptosc-runner.js';

const VALID_FOREIGN_KEYS_METHODS = ['auto', 'rebuild_constraints', 'drop_swap', 'none'];

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
    logger = console,
    onProgress
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
      maxBuffer,
      onProgress
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
      maxBuffer,
      onProgress
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
