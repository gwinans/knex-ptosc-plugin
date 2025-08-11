# knex-ptosc-plugin

## WARNING

This is currently VERY early, prototype code and should not be used in production.

Knex plugin to run [pt-online-schema-change](https://www.percona.com/doc/percona-toolkit/LATEST/pt-online-schema-change.html) with dry-run support and extended options.

## Installation

```
npm install knex-ptosc-plugin
```

## Usage

You can run pt-online-schema-change with a raw SQL Alter statement or using Knex's schema builder syntax.

# Important

If you need to create or drop a table, use `knex.schema.createTable` or `knex.schema.dropTableIfExists`.

This plugin expects `knex_migrations` and `knex_migrations_lock` to exist first.

## Examples

**With Schema Builder:**

```
const { alterTableWithBuilder } = require('knex-ptosc-plugin');

exports.up = async function(knex) {
  await alterTableWithBuilder(knex, 'users', (table) => {
    table.string('nickname');
  }, {
    // Optional plugin options:
    maxLoad: 25,                    // integer, e.g. 25
    criticalLoad: 50,               // integer, e.g. 50
    alterForeignKeysMethod: 'auto', // 'auto' (default), 'rebuild_constraints', or 'drop_swap'
  });
};

exports.down = async function(knex) {
  await alterTableWithBuilder(knex, 'users', (table) => {
    table.dropColumn('nickname');
  });
};
```

**With raw SQL:**

```
const { alterTableWithPTOSC } = require('knex-ptosc-plugin');

exports.up = async function(knex) {
  await alterTableWithPTOSC(knex, 'users', 'ADD COLUMN nickname VARCHAR(255)', {
    maxLoad: 25,
    criticalLoad: 50,
    alterForeignKeysMethod: 'auto',
  });
};

exports.down = async function(knex) {
    await alterTableWithPTOSC(knex, 'users', 'DROP COLUMN nickname', {
        maxLoad: 25,
        criticalLoad: 50,
        alterForeignKeysMethod: 'auto',
    });
};
```
