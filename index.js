import { execFile } from 'child_process';

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
  { timeoutMs = 30000, intervalMs = 500 } = {}
) {
  const hasMigrationsTable = await knex.schema.hasTable('knex_migrations');
  const hasLockTable = await knex.schema.hasTable('knex_migrations_lock');

  if (!hasMigrationsTable || !hasLockTable) {
    throw new Error(
      'Required Knex migration tables do not exist. ' +
      'Ensure knex_migrations and knex_migrations_lock are created before running pt-osc migrations.'
    );
  }

  const start = Date.now();
  let acquired = false;

  while (!acquired) {
    const updated = await knex('knex_migrations_lock')
      .where({ is_locked: 0 })
      .update({ is_locked: 1 })
      .catch(() => 0);

    if (updated === 1) {
      acquired = true;
      break;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timeout acquiring knex_migrations_lock');
    }
    await sleep(intervalMs);
  }

  return {
    release: async () => {
      if (!acquired) return;
      await knex('knex_migrations_lock')
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
  criticalLoad,
  dryRun
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
  if (maxLoad != null) args.push('--max-load', `Threads_connected=${maxLoad}`);
  if (criticalLoad != null) args.push('--critical-load', `Threads_running=${criticalLoad}`);
  return args;
}

function logCommand(ptoscPath, args) {
  const printable = [ptoscPath, ...args.map(a => (/\s/.test(a) ? `"${a}"` : a))].join(' ');
  console.log(`[PT-OSC] Running: ${printable}`);
}

/** Low-level runner (no shell; password via env) */
async function runPtoscProcess({ ptoscPath = 'pt-online-schema-change', args, envPassword }) {
  const env = { ...process.env };
  if (envPassword) env.MYSQL_PWD = String(envPassword);

  logCommand(ptoscPath, args);

  await new Promise((resolve, reject) => {
    execFile(ptoscPath, args, { env }, (err, stdout, stderr) => {
      if (stdout) console.log(stdout.trim());
      if (err) {
        const msg = (stderr && stderr.trim()) || err.message || 'pt-online-schema-change failed';
        return reject(new Error(msg));
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
    criticalLoad,
    alterForeignKeysMethod = 'auto',
    ptoscPath
  } = options;

  if (maxLoad !== undefined && !Number.isInteger(maxLoad)) {
    throw new TypeError(`maxLoad must be an integer, got ${typeof maxLoad}`);
  }
  if (criticalLoad !== undefined && !Number.isInteger(criticalLoad)) {
    throw new TypeError(`criticalLoad must be an integer, got ${typeof criticalLoad}`);
  }
  if (!VALID_FOREIGN_KEYS_METHODS.includes(alterForeignKeysMethod)) {
    throw new TypeError(
      `alterForeignKeysMethod must be one of ${VALID_FOREIGN_KEYS_METHODS.join(', ')}; got '${alterForeignKeysMethod}'.`
    );
  }

  const conn = knex.client.config.connection || {};
  const usedPassword = password ?? conn.password;

  // Dry-run
  console.log(`[PT-OSC] Dry-run for ALTER TABLE ${table} ${alterClause}`);
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
      criticalLoad,
      dryRun: true
    }),
    envPassword: usedPassword
  });

  // Execute
  console.log(`[PT-OSC] Dry-run successful. Executing ALTER TABLE ${table} ${alterClause}`);
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
      criticalLoad,
      dryRun: false
    }),
    envPassword: usedPassword
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

  const { release } = await acquireMigrationLock(knex);
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
