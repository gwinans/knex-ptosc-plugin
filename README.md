# knex-ptosc-plugin

## AI Disclosure

An LLM (GPT-5) was used heavily in the creation of this plugin.

## WARNING

This code is a very early swing at extending Knex to use
`pt-online-schema-change` for DB migrations.

## Intorduction

A [Knex](https://knexjs.org/) helper for running `ALTER TABLE` operations online
using
[Percona Toolkit's `pt-online-schema-change`](https://www.percona.com/doc/percona-toolkit/LATEST/pt-online-schema-change.html)
(pt-osc).

This plugin intercepts Knex schema changes and runs them through **pt-osc** so
they can be executed with minimal locking and downtime.

Github Repo: https://github.com/gwinans/knex-ptosc-plugin

---

## Features

- **Safe execution**: No shell concatenation, no command injection — arguments
  are passed directly to the pt-osc binary.
- **Password safety**: The database password is passed via `MYSQL_PWD`
  environment variable (never on the command line or in logs).
- **Atomic migration lock**: Uses Knex’s migrations lock row
  (`knex_migrations_lock` by default) to prevent concurrent schema changes.
  Table names can be customized with `migrationsTable` and
  `migrationsLockTable`.
- **Dry-run first**: Always runs a pt-osc `--dry-run` before executing.
- **Full ALTER support**: Works with direct ALTER strings or with Knex’s
  `.alterTable()` builder syntax.
- **Respects Knex bindings**: Correctly interpolates values from `.toSQL()`
  output.

---

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

| Option                    | Type                                                       | Default                     | Description                                                                                 |
| ------------------------- | ---------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------- |
| `password`                | `string`                                                   | from Knex connection        | Override DB password; will be passed via `MYSQL_PWD` env                                    |
| `maxLoad`                 | `number`                                                   | `undefined`                 | Passed to `--max-load` (e.g. `Threads_connected=150`)                                       |
| `maxLoadMetric`           | `string`                                                   | `'Threads_running'`         | Metric name used in `--max-load` (e.g. `Threads_connected`)                                 |
| `criticalLoad`            | `number`                                                   | `undefined`                 | Passed to `--critical-load` (e.g. `Threads_running=50`)                                     |
| `criticalLoadMetric`      | `string`                                                   | `'Threads_running'`         | Metric name used in `--critical-load` (e.g. `Threads_running`)                              |
| `alterForeignKeysMethod`  | `'auto' \| 'rebuild_constraints' \| 'drop_swap' \| 'none'` | `'auto'`                    | Passed to `--alter-foreign-keys-method`                                                     |
| `ptoscPath`               | `string`                                                   | `'pt-online-schema-change'` | Path to pt-osc binary                                                                       |
| `analyzeBeforeSwap`       | `boolean`                                                  | `true`                      | `--analyze-before-swap` or `--noanalyze-before-swap`                                        |
| `checkAlter`              | `boolean`                                                  | `true`                      | `--check-alter` or `--nocheck-alter`                                                        |
| `checkForeignKeys`        | `boolean`                                                  | `true`                      | `--check-foreign-keys` or `--nocheck-foreign-keys`                                          |
| `checkInterval`           | `number`                                                   | `undefined`                 | Passed to `--check-interval`                                                                |
| `checkPlan`               | `boolean`                                                  | `true`                      | `--check-plan` or `--nocheck-plan`                                                          |
| `checkReplicationFilters` | `boolean`                                                  | `true`                      | `--check-replication-filters` or `--nocheck-replication-filters`                            |
| `checkReplicaLag`         | `boolean`                                                  | `false`                     | Adds `--check-replica-lag`                                                                  |
| `chunkIndex`              | `string`                                                   | `undefined`                 | Passed to `--chunk-index`                                                                   |
| `chunkIndexColumns`       | `number`                                                   | `undefined`                 | Passed to `--chunk-index-columns`                                                           |
| `chunkSize`               | `number`                                                   | `1000`                      | Passed to `--chunk-size`                                                                    |
| `chunkSizeLimit`          | `number`                                                   | `4.0`                       | Passed to `--chunk-size-limit`                                                              |
| `chunkTime`               | `number`                                                   | `0.5`                       | Passed to `--chunk-time`                                                                    |
| `dropNewTable`            | `boolean`                                                  | `true`                      | `--drop-new-table` or `--nodrop-new-table`                                                  |
| `dropOldTable`            | `boolean`                                                  | `true`                      | `--drop-old-table` or `--nodrop-old-table`                                                  |
| `dropTriggers`            | `boolean`                                                  | `true`                      | `--drop-triggers` or `--nodrop-triggers`                                                    |
| `checkUniqueKeyChange`    | `boolean`                                                  | `true`                      | `--check-unique-key-change` or `--nocheck-unique-key-change`                                |
| `maxLag`                  | `number`                                                   | `25`                        | Passed to `--max-lag`                                                                       |
| `maxBuffer`               | `number`                                                   | `10485760`                  | `child_process.execFile` `maxBuffer` in bytes                                               |
| `logger`                  | `{ log: Function, error: Function }`                       | `console`                   | Override default logging methods                                                            |
| `onProgress`              | `(pct: number) => void`                                    | `undefined`                 | Callback for progress percentage parsed from output; logs include pt-osc ETA when available |
| `statistics`              | `boolean`                                                  | `false`                     | Adds `--statistics`; log and collect internal pt-osc counters                               |
| `onStatistics`            | `(stats: Record<string, number>) => void`                  | `undefined`                 | Invoked with parsed statistics object when `statistics` is true                             |
| `migrationsTable`         | `string`                                                   | `'knex_migrations'`         | Overrides migrations table name used for lock checks                                        |
| `migrationsLockTable`     | `string`                                                   | `'knex_migrations_lock'`    | Overrides migrations lock table name used when acquiring lock                               |
| `timeoutMs`               | `number`                                                   | `30000`                     | Timeout in ms when acquiring migration lock                                                 |
| `intervalMs`              | `number`                                                   | `500`                       | Delay between lock retries in ms                                                            |

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

Set `DEBUG=knex-ptosc-plugin` to print the full pt-online-schema-change command
and all output lines.

```sh
DEBUG=knex-ptosc-plugin knex migrate:latest
```

Without `DEBUG`, only high-level progress percentages are logged. If
pt-online-schema-change exits with an error, its full stdout and stderr are
logged regardless of `DEBUG`, including any trailing lines that lack a newline.

## Testing

Run `npm test` to execute linting and unit tests. Continuous integration also
clones the [kpp-test-app](https://github.com/gwinans/kpp-test-app) and runs its
migrations against a MySQL instance (`root`/`test`, database `ptosc`) to verify
end-to-end behavior.

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

```js
import { alterTableWithPtosc } from "knex-ptosc-plugin";

export async function up(knex) {
  await alterTableWithPtosc(knex, "users", (t) => {
    t.string("nickname").nullable();
  }, {
    maxLoad: 150,
    criticalLoad: 50,
  });
}

export async function down(knex) {
  await alterTableWithPtosc(knex, "users", (t) => {
    t.dropColumn("nickname");
  }, {
    maxLoad: 150,
    criticalLoad: 50,
  });
}
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
