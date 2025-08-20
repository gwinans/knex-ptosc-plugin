import childProcess from 'child_process';

/** Build pt-osc args array (no shell quoting) */
export function buildPtoscArgs({
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
export async function runPtoscProcess({
  ptoscPath = 'pt-online-schema-change',
  args,
  envPassword,
  logger = console,
  maxBuffer = 10 * 1024 * 1024,
  onProgress,
}) {
  const env = { ...process.env };
  if (envPassword) env.MYSQL_PWD = String(envPassword);

  logCommand(ptoscPath, args, logger);

  await new Promise((resolve, reject) => {
    const child = childProcess.spawn(ptoscPath, args, { env, maxBuffer });

    let stdout = '';
    let stderr = '';
    let total = 0;
    const pctRegex = /\b(\d{1,3}(?:\.\d+)?)%/;
    let stdoutLine = '';
    let stderrLine = '';

    function handleChunk(chunk, isErr) {
      const str = chunk.toString();
      total += Buffer.byteLength(str);
      if (total > maxBuffer) {
        child.kill();
        const error = new Error('pt-online-schema-change maxBuffer exceeded');
        error.stdout = stdout;
        error.stderr = stderr;
        return reject(error);
      }

      const lines = (isErr ? stderrLine : stdoutLine) + str;
      const split = lines.split(/\r?\n/);
      if (isErr) {
        stderrLine = split.pop();
        split.forEach(line => {
          if (!line) return;
          logger.error(line);
          const m = line.match(pctRegex);
          if (m && onProgress) onProgress(parseFloat(m[1]));
        });
        stderr += str;
      } else {
        stdoutLine = split.pop();
        split.forEach(line => {
          if (!line) return;
          logger.log(line);
          const m = line.match(pctRegex);
          if (m && onProgress) onProgress(parseFloat(m[1]));
        });
        stdout += str;
      }
    }

    child.stdout && child.stdout.on('data', (c) => handleChunk(c, false));
    child.stderr && child.stderr.on('data', (c) => handleChunk(c, true));

    child.on('error', (err) => {
      logger.error(`pt-online-schema-change failed with code ${err.code}`);
      const error = new Error(err.message || 'pt-online-schema-change failed');
      error.code = err.code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    child.on('close', (code) => {
      if (stdoutLine) {
        logger.log(stdoutLine);
        const m = stdoutLine.match(pctRegex);
        if (m && onProgress) onProgress(parseFloat(m[1]));
      }
      if (stderrLine) {
        logger.error(stderrLine);
        const m = stderrLine.match(pctRegex);
        if (m && onProgress) onProgress(parseFloat(m[1]));
      }
      if (code) {
        logger.error(`pt-online-schema-change failed with code ${code}`);
        const error = new Error('pt-online-schema-change failed');
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        return reject(error);
      }
      resolve();
    });
  });
}
