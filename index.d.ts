import type { Knex } from 'knex';

export interface PtoscOptions {
  password?: string;
  maxLoad?: number;          // Threads_connected limit
  criticalLoad?: number;     // Threads_running limit
  alterForeignKeysMethod?: 'auto' | 'rebuild_constraints' | 'drop_swap' | 'none';
  ptoscPath?: string;        // custom path to pt-online-schema-change
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
