# knex-ptosc-plugin

## AI Disclosure

An LLM (GPT-5) was used heavily in the creation of this plugin.

## WARNING

**This code is a very early swing at extending Knex to use
`pt-online-schema-change` for DB migrations. Use in production at your own
risk.**

## Introduction

A [Knex](https://knexjs.org/) helper for running `ALTER TABLE` operations online
using
[Percona Toolkit's `pt-online-schema-change`](https://www.percona.com/doc/percona-toolkit/LATEST/pt-online-schema-change.html)
(pt-osc).

This plugin offers an alternative to the normal schema builder, routing the
`.alterTable()` builder through **pt-online-schema-change** so changes can be
executed with minimal locking and downtime. It also exposes
`alterTableWithPtoscRaw` for executing raw `ALTER TABLE` statements. For
operations that can be run INSTANT in the engine, `pt-osc` will not be invoked;
instead knex will handle it.

**Github Repo:** https://github.com/gwinans/knex-ptosc-plugin

**Test App:** https://github.com/gwinans/kpp-test-app

Please, come contribute! Star the project!

---

## Features

- **Safe execution**: No shell concatenation, no command injection — arguments
  are passed directly to the pt-osc binary.
- **Password safety**: The database password is passed via `MYSQL_PWD`
  environment variable (never on the command line or in logs).
- **Atomic migration lock**: Uses Knex’s migrations lock row
  (`knex_migrations_lock` by default) to prevent concurrent schema changes.
  Table names can be customized with `migrationsTable` and
  `migrationsLockTable`. Both tables must exist before running migrations;
  otherwise an error is thrown.
- **Dry-run first**: Always runs a pt-osc `--dry-run` before executing.
- **Full ALTER support**: Works with Knex’s `.alterTable()` builder or raw
  `ALTER TABLE` strings via `alterTableWithPtoscRaw`.
- **Respects Knex bindings**: Correctly interpolates values from `.toSQL()`
  output.
- **Instant alters when possible**: Attempts native
  `ALTER TABLE ... ALGORITHM=INSTANT` and falls back to pt-osc when unsupported or
  when MySQL returns error 4092 ("Maximum row versions").
- **Native index operations**: `ADD INDEX` and `DROP INDEX` statements run
  directly via Knex without pt-osc.

Servers running MySQL 5.6 or 5.7 skip the instant-alter attempt and always use
pt-online-schema-change. This will not be changed - MySQL 5.6 and 5.7 are
long-past End-of-Life.

## Requirements

- Node.js 16+
- Knex configured for MySQL or MariaDB
- [Percona Toolkit](https://www.percona.com/doc/percona-toolkit/LATEST/pt-online-schema-change.html)
  installed and `pt-online-schema-change` available in `$PATH`
- MySQL user with appropriate privileges, as required by Knex.

---

## Installation

```sh
npm install knex-ptosc-plugin
```

---

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `password` | `string` | from Knex connection | Override DB password; passed via `MYSQL_PWD` env |
| `maxLoad` | `number` | `undefined` | Passed to `--max-load` (e.g. `Threads_connected=150`) |
| `maxLoadMetric` | `string` | `'Threads_running'` | Metric name used in `--max-load` (e.g. `Threads_connected`) |
| `criticalLoad` | `number` | `undefined` | Passed to `--critical-load` (e.g. `Threads_running=50`) |
| `criticalLoadMetric` | `string` | `'Threads_running'` | Metric name used in `--critical-load` (e.g. `Threads_running`) |
| `alterForeignKeysMethod` | `'auto' \| 'rebuild_constraints' \| 'drop_swap' \| 'none'` | `'auto'` | Passed to `--alter-foreign-keys-method` |
| `ptoscPath` | `string` | `'pt-online-schema-change'` | Path to pt-osc binary |
| `forcePtosc` | `boolean` | `false` | Skip the instant-alter attempt and always run pt-osc |
| `ptoscMinRows` | `number` | `0` | Minimum row count required to use pt-osc; below this, ALTER runs natively |
| `analyzeBeforeSwap` | `boolean` | `true` | `--analyze-before-swap` or `--noanalyze-before-swap` |
| `checkAlter` | `boolean` | `true` | `--check-alter` or `--nocheck-alter` |
| `checkForeignKeys` | `boolean` | `true` | `--check-foreign-keys` or `--nocheck-foreign-keys` |
| `checkInterval` | `number` | `undefined` | Passed to `--check-interval` |
| `checkPlan` | `boolean` | `true` | `--check-plan` or `--nocheck-plan` |
| `checkReplicationFilters` | `boolean` | `true` | `--check-replication-filters` or `--nocheck-replication-filters` |
| `checkReplicaLag` | `boolean` | `false` | Adds `--check-replica-lag` |
| `chunkIndex` | `string` | `undefined` | Passed to `--chunk-index` |
| `chunkIndexColumns` | `number` | `undefined` | Passed to `--chunk-index-columns` |
| `chunkSize` | `number` | `1000` | Passed to `--chunk-size` |
| `chunkSizeLimit` | `number` | `4.0` | Passed to `--chunk-size-limit` |
| `chunkTime` | `number` | `0.5` | Passed to `--chunk-time` |
| `dropNewTable` | `boolean` | `true` | `--drop-new-table` or `--nodrop-new-table` |
| `dropOldTable` | `boolean` | `true` | `--drop-old-table` or `--nodrop-old-table` |
| `dropTriggers` | `boolean` | `true` | `--drop-triggers` or `--nodrop-triggers` |
| `checkUniqueKeyChange` | `boolean` | `true` | `--check-unique-key-change` or `--nocheck-unique-key-change` |
| `maxLag` | `number` | `25` | Passed to `--max-lag` |
| `maxBuffer` | `number` | `10485760` | `child_process.execFile` `maxBuffer` in bytes |
| `logger` | `{ log: Function, error: Function }` | `console` | Override default logging methods |
| `onProgress` | `(pct: number, eta?: string) => void` | `undefined` | Callback for progress percentage and optional ETA parsed from output; logs include pt-osc ETA when available |
| `statistics` | `boolean` | `false` | Adds `--statistics`; log and collect internal pt-osc counters |
| `onStatistics` | `(stats: Record<string, number>) => void` | `undefined` | Invoked with parsed statistics object when `statistics` is true |
| `migrationsTable` | `string` | `'knex_migrations'` | Overrides migrations table name used for lock checks |
| `migrationsLockTable` | `string` | `'knex_migrations_lock'` | Overrides migrations lock table name used when acquiring lock |
| `timeoutMs` | `number` | `30000` | Timeout in ms when acquiring migration lock |
| `intervalMs` | `number` | `500` | Delay between lock retries in ms |

### Statistics example

When `statistics: true`, pt-online-schema-change prints internal counters at the
end of the run. These are parsed into an object, logged via the provided logger,
and returned (or sent to `onStatistics`). Example output:

```
# Event          Count
# =====          =====
# chunk-size     1000
# copy_rows      12345
```

## Debugging

The full `pt-online-schema-change` command is logged before execution regardless
of `DEBUG`. Set `DEBUG=knex-ptosc-plugin` to enable verbose, line-by-line output.

```sh
DEBUG=knex-ptosc-plugin knex migrate:latest
```

Without `DEBUG`, only high-level progress percentages are logged. If
pt-online-schema-change exits with an error, its full stdout and stderr are
logged regardless of `DEBUG`, including any trailing lines that lack a newline.

## Testing

Run `npm test` to execute linting and unit tests. Run `npm run test:coverage`
to include coverage reporting. Continuous integration also clones the
[kpp-test-app](https://github.com/gwinans/kpp-test-app) and runs its migrations
against a MySQL instance (`root`/`test`, database `ptosc`) to verify end-to-end
behavior.

---

## Safety & Security

- **No shell**: Commands are executed via
  [`child_process.spawn`](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)
  with an **args array**, so backticks, semicolons, or other shell
  metacharacters in table names or SQL will not be interpreted by a shell.
- **Password is hidden**: Never appears in process list, logs, or command
  history.
- **Atomic locks**: Lock acquisition uses `UPDATE ... WHERE is_locked=0` to
  avoid stealing locks from another process.
- **Dry-run first**: Always verifies the migration before execution.

---

## Example Migration
The `alterTableWithPtosc` helper accepts a table name and a schema builder
callback, ensuring all changes use Knex's builder API.
### CommonJS

```js
const { alterTableWithPtosc } = require('knex-ptosc-plugin');

exports.up = function (knex) {
  return alterTableWithPtosc(
    knex,
    'widgets',
    (table) => {
      table.bigInteger('qty').alter();
    },
    { chunkSize: 500 }
  );
};

exports.down = function (knex) {
  return alterTableWithPtosc(
    knex,
    'widgets',
    (table) => {
      table.integer('qty').alter();
    },
    { chunkSize: 500 }
  );
};
```

### ESM

```js
import { alterTableWithPtosc } from 'knex-ptosc-plugin';

export function up(knex) {
  return alterTableWithPtosc(
    knex,
    'widgets',
    (table) => {
      table.bigInteger('qty').alter();
    },
    { chunkSize: 500 }
  );
}

export function down(knex) {
  return alterTableWithPtosc(
    knex,
    'widgets',
    (table) => {
      table.integer('qty').alter();
    },
    { chunkSize: 500 }
  );
}
```

### Raw SQL

```js
import { alterTableWithPtoscRaw } from 'knex-ptosc-plugin';

export function up(knex) {
  return alterTableWithPtoscRaw(
    knex,
    'ALTER TABLE widgets ALTER COLUMN qty TYPE BIGINT',
    { statistics: true }
  );
}
```

## Advanced Usage

### Handling Foreign Keys

`pt-online-schema-change` may refuse to run when tables have foreign key constraints. Use `alterForeignKeysMethod: 'drop_swap'` or `'rebuild_constraints'` to control how pt-osc manages them:

```js
return alterTableWithPtosc(
  knex,
  'widgets',
  (table) => {
    table.dropColumn('category_id');
  },
  { alterForeignKeysMethod: 'drop_swap' } // or 'rebuild_constraints'
);
```

### Replica Lag Safeguard

Enable `checkReplicaLag: true` to have pt-osc abort if replicas fall behind, useful in production environments with read replicas:

```js
return alterTableWithPtosc(
  knex,
  'widgets',
  (table) => {
    table.string('status').defaultTo('pending');
  },
  { checkReplicaLag: true }
);
```

### Capture Statistics

Collect pt-osc statistics by setting `statistics: true` and handling them in the `onStatistics` callback:

```js
return alterTableWithPtosc(
  knex,
  'widgets',
  (table) => {
    table.bigInteger('qty').alter();
  },
  {
    statistics: true,
    onStatistics: (stats) => {
      console.log('pt-osc stats', stats);
    },
  }
);
```

---

## Troubleshooting

- **`pt-online-schema-change: command not found`**\
  The plugin runs `which pt-online-schema-change` during initialization and will
  throw if the binary cannot be found. Make sure Percona Toolkit is installed
  and in your PATH, or pass `ptoscPath` in options.

- **Permission errors**\
  Verify you followed the installation instructions for Knex.

- **Foreign key issues**\
  Use `alterForeignKeysMethod: 'rebuild_constraints'` or `'drop_swap'` if pt-osc
  refuses to run due to FK constraints. Be careful with self-referencing FKs.
  Even ptosc can't handle them correctly.

---

## License

This project is licensed under the [MIT License](LICENSE).

© 2025 Geoff Winans
