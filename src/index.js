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
async function runAlterClauseWithPtosc(knex, table, alterClause, validatedOptions) {
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
  } = validatedOptions;

  const conn = knex.client.config.connection || {};
  const usedPassword = password ?? conn.password;

  const debug = isDebugEnabled();

  const baseArgs = {
    alterSQL: alterClause,
    database: table.database ?? conn.database,
    table: table.name,
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
    logger.log(`[PT-OSC] Dry-run for ALTER TABLE ${table.target} ${alterClause}`);
  } else {
    logger.log(`[PT-OSC] Modifying table ${table.target}`);
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
    logger.log(`[PT-OSC] Dry-run successful. Executing ALTER TABLE ${table.target} ${alterClause}`);
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

const identifier = '(?:`(?:[^`]|``)+`|[\\w$]+)';
const targetPattern = new RegExp('^ALTER\\s+TABLE\\s+(?:(' + identifier + ')\\s*\\.\\s*)?(' + identifier + ')\\s+([\\s\\S]+)$', 'i');
const columnList = identifier + '(?:\\s*,\\s*' + identifier + ')*';
const simpleIndex = new RegExp('^(?:ADD\\s+(?:UNIQUE\\s+)?(?:INDEX|KEY)\\s+' + identifier +
  '\\s*\\(\\s*' + columnList + '\\s*\\)|DROP\\s+(?:INDEX|KEY)\\s+' + identifier + ')$', 'i');
// Only independent scalar column definitions can be opted into a shared copy.
const simpleColumn = new RegExp('^(?:ADD|MODIFY)\\s+(?:COLUMN\\s+)?(' + identifier +
  ')\\s+(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|VARCHAR\\(\\d+\\))' +
  '(?:\\s+UNSIGNED)?(?:\\s+(?:NOT\\s+)?NULL)?$', 'i');

function unquote(name) {
  return name?.replace(/^`|`$/g, '').replace(/``/g, '`');
}

function parseAlter(sql) {
  if (!/^ALTER\s+TABLE\b/i.test(sql)) throw new Error('Only ALTER TABLE statements are supported: ' + sql);
  const match = targetPattern.exec(sql.replace(/;$/, '').trimEnd());
  if (!match) throw new Error('Unable to parse ALTER TABLE statement: ' + sql);
  const [, schema, name, clause] = match;
  const target = schema ? schema + '.' + name : name;
  return { database: unquote(schema), name: unquote(name), target, clause };
}

function groupChanges(statements) {
  const groups = [];
  let columns = new Set();
  for (const statement of statements) {
    const match = simpleColumn.exec(statement.clause);
    const column = match && unquote(match[1]).toLowerCase();
    const previous = groups[groups.length - 1];
    if (column && columns.size && previous.target === statement.target && !columns.has(column)) {
      previous.clause += ', ' + statement.clause;
    } else {
      groups.push({ ...statement });
      columns = new Set();
    }
    if (column) columns.add(column);
  }
  return groups;
}

async function belowThreshold(knex, statement, threshold) {
  try {
    const result = await knex.raw(
      'SELECT TABLE_ROWS FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [statement.database ?? knex.client.config.connection.database, statement.name]
    );
    const rows = Array.isArray(result) ? result[0] : result;
    const row = Array.isArray(rows) ? rows[0] : rows;
    const count = row?.TABLE_ROWS ?? row?.table_rows;
    return count != null && count < threshold;
  } catch {
    return false;
  }
}

async function executeStatements(knex, statements, options) {
  const settings = validatePtoscOptions(options);
  const { forcePtosc = false, ptoscMinRows = 0, groupAlters = false, lockOwner = 'plugin', onPlan } = options;
  assertBoolean('forcePtosc', forcePtosc);
  assertBoolean('groupAlters', groupAlters);
  if (ptoscMinRows !== 0) assertPositiveInteger('ptoscMinRows', ptoscMinRows);
  if (!['knex', 'plugin'].includes(lockOwner)) throw new TypeError("lockOwner must be 'knex' or 'plugin'");
  if (onPlan !== undefined && typeof onPlan !== 'function') throw new TypeError('onPlan must be a function');
  if (groupAlters && !forcePtosc) throw new TypeError('groupAlters requires forcePtosc');
  const plan = groupAlters ? groupChanges(statements) : statements;
  const lock = lockOwner === 'plugin' ? await acquireMigrationLock(knex, options) : null;
  const stats = [];
  try {
    for (const statement of plan) {
      const { target, clause } = statement;
      const sql = 'ALTER TABLE ' + target + ' ' + clause;
      const report = route => onPlan?.({ table: target, clause, route });
      if (!forcePtosc) {
        if (simpleIndex.test(clause) || (ptoscMinRows && await belowThreshold(knex, statement, ptoscMinRows))) {
          report('native');
          await knex.raw(sql);
          continue;
        }
        const { major, minor } = await getMysqlVersion(knex);
        if (!(major === 5 && (minor === 6 || minor === 7))) {
          report('instant');
          try {
            await knex.raw(sql + ', ALGORITHM=INSTANT');
            continue;
          } catch (err) {
            const msg = err.message || '';
            if (!(INSTANT_UNSUPPORTED_ERRNOS.includes(err.errno) ||
                (/ALGORITHM=INSTANT/i.test(msg) && /unsupported|not supported/i.test(msg)) ||
                /Maximum row versions/i.test(msg))) throw err;
          }
        }
      }
      report('ptosc');
      const counters = await runAlterClauseWithPtosc(knex, statement, clause, settings);
      if (counters) stats.push(counters);
    }
  } finally {
    await lock?.release();
  }
  return stats.length ? stats : undefined;
}

export async function alterTableWithPtosc(knex, tableName, alterCallback, options = {}) {
  const compiled = knex.schema.alterTable(tableName, alterCallback).toSQL();
  const statements = [compiled].flat().map(s => knex.raw(s.sql ?? s, s.bindings ?? []).toQuery().trim());
  if (!statements.some(sql => /^ALTER\s+TABLE\b/i.test(sql))) {
    throw new Error('No ALTER TABLE statements generated for "' + tableName + '".');
  }
  return executeStatements(knex, statements.map(parseAlter), options);
}

export async function alterTableWithPtoscRaw(knex, ...args) {
  const last = args[args.length - 1];
  const options = last && typeof last === 'object' && !Array.isArray(last) ? args.pop() : {};
  const statements = args.flat().map(sql => String(sql).trim()).filter(Boolean);
  if (!statements.length) throw new Error('No SQL statements provided.');
  return executeStatements(knex, statements.map(parseAlter), options);
}
