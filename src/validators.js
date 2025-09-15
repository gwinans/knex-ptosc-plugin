export function assertPositiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer, got ${value}`);
  }
}

export function assertPositiveNumber(name, value) {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive number, got ${value}`);
  }
}

const VALID_FOREIGN_KEYS_METHODS = ['auto', 'rebuild_constraints', 'drop_swap', 'none'];

export function validatePtoscOptions(options = {}) {
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

  if (maxLoad !== undefined) assertPositiveInteger('maxLoad', maxLoad);
  if (criticalLoad !== undefined) assertPositiveInteger('criticalLoad', criticalLoad);
  if (checkInterval !== undefined) assertPositiveInteger('checkInterval', checkInterval);
  if (chunkIndexColumns !== undefined) assertPositiveInteger('chunkIndexColumns', chunkIndexColumns);
  if (chunkSize !== undefined) assertPositiveInteger('chunkSize', chunkSize);
  if (chunkSizeLimit !== undefined) assertPositiveNumber('chunkSizeLimit', chunkSizeLimit);
  if (chunkTime !== undefined) assertPositiveNumber('chunkTime', chunkTime);
  if (maxLag !== undefined) assertPositiveInteger('maxLag', maxLag);
  if (maxBuffer !== undefined) assertPositiveInteger('maxBuffer', maxBuffer);
  if (!VALID_FOREIGN_KEYS_METHODS.includes(alterForeignKeysMethod)) {
    throw new TypeError(
      `alterForeignKeysMethod must be one of ${VALID_FOREIGN_KEYS_METHODS.join(', ')}; got '${alterForeignKeysMethod}'.`
    );
  }

  return {
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
  };
}
