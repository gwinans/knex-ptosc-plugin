const { alterTableWithPtosc, alterTableWithPtoscRaw } = require('knex-ptosc-plugin');
const assert = require('node:assert/strict');

exports.up = async knex => {
  await knex.schema.createTable('widgets', t => {
    t.increments('id');
    t.integer('qty');
  });
  await knex('widgets').insert({ qty: 7 });
  const routes = [];
  const options = { lockOwner: 'knex', onPlan: step => routes.push(step.route) };
  await alterTableWithPtosc(knex, 'widgets', t => t.integer('priority'), options);
  await alterTableWithPtoscRaw(knex, 'ALTER TABLE widgets ADD INDEX qty_ix (qty)', options);
  await alterTableWithPtoscRaw(knex,
    'ALTER TABLE widgets MODIFY COLUMN qty BIGINT',
    'ALTER TABLE widgets MODIFY COLUMN priority BIGINT',
    { ...options, forcePtosc: true, groupAlters: true });
  assert.deepEqual(routes, ['instant', 'native', 'ptosc']);
};
exports.down = async knex => knex.schema.dropTable('widgets');
