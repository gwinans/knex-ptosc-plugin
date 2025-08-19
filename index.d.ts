import type { Knex } from 'knex';

export interface PtoscOptions {
  password?: string;
  maxLoad?: number;
  criticalLoad?: number;
  alterForeignKeysMethod?: 'auto' | 'rebuild_constraints' | 'drop_swap' | 'none';
  ptoscPath?: string;
  analyzeBeforeSwap?: boolean;
  checkAlter?: boolean;
  checkForeignKeys?: boolean;
  checkInterval?: number;
  checkPlan?: boolean;
  checkReplicationFilters?: boolean;
  checkReplicaLag?: boolean;
  chunkIndex?: string;
  chunkIndexColumns?: number;
  chunkSize?: number;
  chunkSizeLimit?: number;
  chunkTime?: number;
  dropNewTable?: boolean;
  dropOldTable?: boolean;
  dropTriggers?: boolean;
  checkUniqueKeyChange?: boolean;
  maxLag?: number;
  logger?: { log: (...args: any[]) => void; error: (...args: any[]) => void };
  migrationsTable?: string;
  migrationsLockTable?: string;
}

/**
 * Public API: ONLY builder-based alters (no raw SQL).
 */
export declare function alterTableWithBuilder(
  knex: Knex,
  tableName: string,
  alterCallback: (tableBuilder: Knex.AlterTableBuilder) => void,
  options?: PtoscOptions
): Promise<void>;
