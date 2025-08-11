import type { Knex } from 'knex';

export interface PtoscOptions {
  password?: string;
  maxLoad?: number;          // Threads_connected limit
  criticalLoad?: number;     // Threads_running limit
  alterForeignKeysMethod?: 'auto' | 'rebuild_constraints' | 'drop_swap' | 'none';
  ptoscPath?: string;        // custom path to pt-online-schema-change
}

export declare function alterTableWithPTOSC(
  knex: Knex,
  table: string,
  alterSQL: string,
  options?: PtoscOptions
): Promise<void>;

export declare function alterTableWithBuilder(
  knex: Knex,
  tableName: string,
  alterCallback: (tableBuilder: Knex.AlterTableBuilder) => void,
  options?: PtoscOptions
): Promise<void>;
