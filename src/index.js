import { acquireMigrationLock } from './lock.js';
import { buildPtoscArgs, runPtoscProcess } from './ptosc-runner.js';
import { isDebugEnabled } from './debug.js';

const VALID_FOREIGN_KEYS_METHODS = ['auto', 'rebuild_constraints', 'drop_swap', 'none'];

const versionCache = new WeakMap();

async function getMysqlVersion(knex) {
  if (!versionCache.has(knex)) {
    const res = await knex.raw('SELECT VERSION() AS version');
    const row = Array.isArray(res) ? res[0] : res;
    const ver = Array.isArray(row) ? row[0].version : row.version;
    const m = /(\d+)\.(\d+)/.exec(ver);
    versionCache.set(knex, {
      major: m ? Number(m[1]) : 0,
      minor: m ? Number(m[2]) : 0
    });
  }
  return versionCache.get(knex);
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
    logger = console,
    onProgress,
    statistics = false,
    onStatistics
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

  const debug = isDebugEnabled();

  if (debug) {
    logger.log(`[PT-OSC] Dry-run for ALTER TABLE ${table} ${alterClause}`);
  } else {
    logger.log(`[PT-OSC] Modifying table ${table}`);
  }

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
      maxLag,
      statistics
    }),
    envPassword: usedPassword,
    logger,
    maxBuffer,
    onProgress: onProgress ? (pct, eta) => onProgress(pct, eta) : undefined,
    printCommand: debug
  });

  if (debug) {
    logger.log(`[PT-OSC] Dry-run successful. Executing ALTER TABLE ${table} ${alterClause}`);
  }
  const { statistics: stats } = await runPtoscProcess({
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
      maxLag,
      statistics
    }),
    envPassword: usedPassword,
    logger,
    maxBuffer,
    onProgress: (pct, eta) => {
      if (onProgress) onProgress(pct, eta);
      if (!debug) {
        const msg = eta ? `[PT-OSC] ${pct}% ETA: ${eta}` : `[PT-OSC] ${pct}%`;
        logger.log(msg);
      }
    },
    onStatistics,
    printCommand: true
  });
  return statistics ? stats : undefined;
}

async function runAlterClause(knex, table, alterClause, options = {}) {
  const { forcePtosc, ptoscMinRows } = options;

  if (ptoscMinRows !== undefined && (!Number.isInteger(ptoscMinRows) || ptoscMinRows <= 0)) {
    throw new TypeError(`ptoscMinRows must be a positive integer, got ${ptoscMinRows}`);
  }

  if (ptoscMinRows !== undefined) {
    const conn = knex.client.config.connection || {};
    let tbl = String(table).replace(/`/g, '');
    let db = conn.database;
    if (tbl.includes('.')) {
      const parts = tbl.split('.');
      if (parts.length === 2) {
        db = parts[0];
        tbl = parts[1];
      }
    }
    try {
      const res = await knex.raw(
        'SELECT TABLE_ROWS FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [db, tbl]
      );
      const row = Array.isArray(res) ? res[0] : res;
      const data = Array.isArray(row) ? row[0] : row;
      const rowCount = data ? data.TABLE_ROWS ?? data.table_rows : undefined;
      if (rowCount !== undefined && rowCount < ptoscMinRows) {
        await knex.raw(`ALTER TABLE ${table} ${alterClause}`);
        return;
      }
    } catch {
      // Ignore row count errors and fall back to normal logic
    }
  }

  if (!forcePtosc) {
    const { major, minor } = await getMysqlVersion(knex);
    if (!(major === 5 && (minor === 6 || minor === 7))) {
      const sql = `ALTER TABLE ${table} ${alterClause}, ALGORITHM=INSTANT`;
      try {
        await knex.raw(sql);
        return;
      } catch (err) {
        const msg = err.message || '';
        if (
          err.errno === 1846 ||
          err.errno === 1847 ||
          err.errno === 4092 ||
          (/ALGORITHM=INSTANT/i.test(msg) && /unsupported|not supported/i.test(msg)) ||
          /Maximum row versions/i.test(msg)
        ) {
          return await runAlterClauseWithPtosc(knex, table, alterClause, options);
        }
        throw err;
      }
    }
  }
  return await runAlterClauseWithPtosc(knex, table, alterClause, options);
}

/**
 * Public API: Knex builder path run through pt-online-schema-change.
 * Compiles the alterTable callback, extracts ALTER statements, applies bindings,
 * and runs each via pt-osc under the migration lock..
 */
export async function alterTableWithPtosc(knex, tableName, alterCallback, options = {}) {
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
  const stats = [];
  try {
    for (const fullAlter of alterStatements) {
      // Extract the clause after: ALTER TABLE <name> <CLAUSE>
      const m = fullAlter.match(/^ALTER\s+TABLE\s+(`?(?:[^`.\s]+`?\.)?`?[^`\s]+`?)\s+(.*)$/i);
      const clause = m ? m[2] : fullAlter.replace(/^ALTER\s+TABLE\s+\S+\s+/i, '');

      // If the clause only adds or drops indexes, run it natively via Knex.
      if (/\b(ADD|DROP)\s+(?:UNIQUE\s+)?(?:INDEX|KEY)\b/i.test(clause)) {
        await knex.raw(fullAlter);
        continue;
      }

      const s = await runAlterClause(knex, tableName, clause, options);
      if (s) stats.push(s);
    }
  } finally {
    await release();
  }
  return stats.length ? stats : undefined;
}
