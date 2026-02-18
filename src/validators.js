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

export function assertBoolean(name, value) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean, got ${value}`);
  }
}

export function assertNonEmptyString(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string, got ${value}`);
  }
}

export function assertFunction(name, value) {
  if (typeof value !== 'function') {
    throw new TypeError(`${name} must be a function, got ${value}`);
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
  if (maxLoadMetric !== undefined) assertNonEmptyString('maxLoadMetric', maxLoadMetric);
  if (criticalLoad !== undefined) assertPositiveInteger('criticalLoad', criticalLoad);
  if (criticalLoadMetric !== undefined) assertNonEmptyString('criticalLoadMetric', criticalLoadMetric);
  if (checkInterval !== undefined) assertPositiveInteger('checkInterval', checkInterval);
  if (chunkIndexColumns !== undefined) assertPositiveInteger('chunkIndexColumns', chunkIndexColumns);
  if (chunkSize !== undefined) assertPositiveInteger('chunkSize', chunkSize);
  if (chunkSizeLimit !== undefined) assertPositiveNumber('chunkSizeLimit', chunkSizeLimit);
  if (chunkTime !== undefined) assertPositiveNumber('chunkTime', chunkTime);
  if (maxLag !== undefined) assertPositiveInteger('maxLag', maxLag);
  if (maxBuffer !== undefined) assertPositiveInteger('maxBuffer', maxBuffer);
  if (ptoscPath !== undefined) assertNonEmptyString('ptoscPath', ptoscPath);
  if (chunkIndex !== undefined) assertNonEmptyString('chunkIndex', chunkIndex);

  if (typeof logger !== 'object' || logger == null) {
    throw new TypeError(`logger must be an object with log/error methods, got ${logger}`);
  }
  assertFunction('logger.log', logger.log);
  assertFunction('logger.error', logger.error);

  if (onProgress !== undefined) assertFunction('onProgress', onProgress);
  if (onStatistics !== undefined) assertFunction('onStatistics', onStatistics);

  assertBoolean('analyzeBeforeSwap', analyzeBeforeSwap);
  assertBoolean('checkAlter', checkAlter);
  assertBoolean('checkForeignKeys', checkForeignKeys);
  assertBoolean('checkPlan', checkPlan);
  assertBoolean('checkReplicationFilters', checkReplicationFilters);
  assertBoolean('checkReplicaLag', checkReplicaLag);
  assertBoolean('dropNewTable', dropNewTable);
  assertBoolean('dropOldTable', dropOldTable);
  assertBoolean('dropTriggers', dropTriggers);
  assertBoolean('checkUniqueKeyChange', checkUniqueKeyChange);
  assertBoolean('statistics', statistics);

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
