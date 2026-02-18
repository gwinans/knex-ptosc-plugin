import { acquireMigrationLock } from './lock.js';
import { buildPtoscArgs, runPtoscProcess } from './ptosc-runner.js';
import { isDebugEnabled } from './debug.js';
import { assertBoolean, assertPositiveInteger, validatePtoscOptions } from './validators.js';
const INSTANT_UNSUPPORTED_ERRNOS = [1846, 1847, 4092];

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
async function runAlterClauseWithPtosc(knex, table, alterClause, options = {}, validatedOptions) {
  const {
    password,
    maxLoad,
    maxLoadMetric,
    criticalLoad,
    criticalLoadMetric,
    alterForeignKeysMethod,
    ptoscPath,
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
    maxBuffer,
    logger,
    onProgress,
    statistics,
    onStatistics
  } = validatedOptions ?? validatePtoscOptions(options);

  const conn = knex.client.config.connection || {};
  const usedPassword = password ?? conn.password;

  const debug = isDebugEnabled();

  const baseArgs = {
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
  };
  const dryRunArgs = { ...baseArgs, dryRun: true };
  const executeArgs = { ...baseArgs, dryRun: false };

  if (debug) {
    logger.log(`[PT-OSC] Dry-run for ALTER TABLE ${table} ${alterClause}`);
  } else {
    logger.log(`[PT-OSC] Modifying table ${table}`);
  }

  await runPtoscProcess({
    ptoscPath,
    args: buildPtoscArgs(dryRunArgs),
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
    args: buildPtoscArgs(executeArgs),
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
  const validatedOptions = validatePtoscOptions(options);
  const { forcePtosc, ptoscMinRows = 0 } = options;

  if (forcePtosc !== undefined) {
    assertBoolean('forcePtosc', forcePtosc);
  }

  if (ptoscMinRows !== 0) {
    assertPositiveInteger('ptoscMinRows', ptoscMinRows);
  }

  if (ptoscMinRows > 0) {
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
          INSTANT_UNSUPPORTED_ERRNOS.includes(err.errno) ||
          (/ALGORITHM=INSTANT/i.test(msg) && /unsupported|not supported/i.test(msg)) ||
          /Maximum row versions/i.test(msg)
        ) {
          return await runAlterClauseWithPtosc(knex, table, alterClause, options, validatedOptions);
        }
        throw err;
      }
    }
  }
  return await runAlterClauseWithPtosc(knex, table, alterClause, options, validatedOptions);
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

export async function alterTableWithPtoscRaw(knex, ...args) {
  let options = {};
  if (args.length === 0) {
    throw new Error('No SQL statements provided.');
  }
  if (typeof args[args.length - 1] === 'object' && typeof args[args.length - 1] !== 'string') {
    options = args.pop();
  }
  const sqls = args.flat().map(sql => String(sql).trim()).filter(Boolean);
  if (sqls.length === 0) {
    throw new Error('No SQL statements provided.');
  }

  const { release } = await acquireMigrationLock(knex, options);
  const stats = [];
  try {
    for (const fullAlter of sqls) {
      if (!/^ALTER\s+TABLE\b/i.test(fullAlter)) {
        throw new Error(`Only ALTER TABLE statements are supported: ${fullAlter}`);
      }
      const m = fullAlter.match(/^ALTER\s+TABLE\s+(`?(?:[^`.\s]+`?\.)?`?[^`\s]+`?)\s+(.*)$/i);
      if (!m) {
        throw new Error(`Unable to parse ALTER TABLE statement: ${fullAlter}`);
      }
      const table = m[1];
      const clause = m[2];
      if (/\b(ADD|DROP)\s+(?:UNIQUE\s+)?(?:INDEX|KEY)\b/i.test(clause)) {
        await knex.raw(fullAlter);
        continue;
      }
      const s = await runAlterClause(knex, table, clause, options);
      if (s) stats.push(s);
    }
  } finally {
    await release();
  }
  return stats.length ? stats : undefined;
}
