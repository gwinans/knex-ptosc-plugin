const { alterTableWithPtoscRaw } = require('knex-ptosc-plugin');
const verifyOrders = require('../verify-orders.cjs');

async function alterOrders(knex, method, oldType, newType) {
  const options = { lockOwner: 'knex', forcePtosc: true, alterForeignKeysMethod: method };
  await alterTableWithPtoscRaw(knex, 'ALTER TABLE orders MODIFY amount ' + newType + ' NOT NULL', options);
  await verifyOrders(knex, newType, oldType);
  await alterTableWithPtoscRaw(knex, 'ALTER TABLE order_items MODIFY quantity ' + newType + ' NOT NULL', options);
  await verifyOrders(knex, newType, newType);
}

exports.up = knex => alterOrders(knex, 'auto', 'int', 'bigint');
exports.down = knex => alterOrders(knex, 'rebuild_constraints', 'bigint', 'int');
