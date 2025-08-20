import childProcess from 'child_process';
import { isDebugEnabled } from './debug.js';

const resolvedPtoscPaths = new Map();

/** Ensure pt-online-schema-change is available and return its path */
export function resolvePtoscPath(ptoscPath = 'pt-online-schema-change') {
  if (resolvedPtoscPaths.has(ptoscPath)) return resolvedPtoscPaths.get(ptoscPath);

  const { status, stdout } = childProcess.spawnSync('which', [ptoscPath]);
  if (status !== 0) {
    throw new Error(
      `pt-online-schema-change binary not found: ${ptoscPath}. Install Percona Toolkit and ensure pt-online-schema-change is in your PATH.`
    );
  }
  const resolved = stdout.toString().trim();
  resolvedPtoscPaths.set(ptoscPath, resolved);
  return resolved;
}

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
  maxLag = 25,
  statistics = false
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
  if (statistics) args.push('--statistics');
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
  onStatistics,
  printCommand = true,
}) {
  const debug = isDebugEnabled();
  const resolvedPath = resolvePtoscPath(ptoscPath);
  const env = { ...process.env };
  if (envPassword) env.MYSQL_PWD = String(envPassword);

  if (printCommand) {
    logCommand(resolvedPath, args, logger);
  }

  const result = await new Promise((resolve, reject) => {
    const child = childProcess.spawn(resolvedPath, args, { env, maxBuffer });

    let stdout = '';
    let stderr = '';
    let total = 0;
    const progressRegex = /\b(\d{1,3}(?:\.\d+)?)%(?:\s+(\d+:\d+(?::\d+)?)\s+remain)?/;
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
          if (debug) logger.error(line);
          const m = line.match(progressRegex);
          if (m && onProgress) onProgress(parseFloat(m[1]), m[2]);
        });
        stderr += str;
      } else {
        stdoutLine = split.pop();
        split.forEach(line => {
          if (!line) return;
          if (debug) logger.log(line);
          const m = line.match(progressRegex);
          if (m && onProgress) onProgress(parseFloat(m[1]), m[2]);
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
        if (debug) logger.log(stdoutLine);
        const m = stdoutLine.match(progressRegex);
        if (m && onProgress) onProgress(parseFloat(m[1]), m[2]);
      }
      if (stderrLine) {
        if (debug) logger.error(stderrLine);
        const m = stderrLine.match(progressRegex);
        if (m && onProgress) onProgress(parseFloat(m[1]), m[2]);
      }
      if (code) {
        logger.error(`pt-online-schema-change failed with code ${code}`);
        const error = new Error('pt-online-schema-change failed');
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        return reject(error);
      }
      const combined = `${stdout}\n${stderr}`;
      const stats = {};
      combined.split(/\r?\n/).forEach(line => {
        const m = line.match(/^#\s*([^#]+?)\s+(\d+(?:\.\d+)?)\s*$/);
        if (m) {
          stats[m[1].trim()] = Number(m[2]);
        }
      });
      const statsCopy = { ...stats };
      const hasStats = Object.keys(statsCopy).length > 0;
      if (hasStats) {
        logger.log(
          `[PT-OSC] Statistics: ${Object.entries(statsCopy)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')}`
        );
        if (onStatistics) onStatistics(statsCopy);
      }
      resolve({ stdout, stderr, statistics: statsCopy });
    });
  });
  return result;
}
