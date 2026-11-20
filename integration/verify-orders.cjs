const assert = require('node:assert/strict');

module.exports = async function verifyOrders(knex, parentType, childType) {
  assert.equal((await knex('orders').columnInfo('amount')).type, parentType);
  assert.equal((await knex('order_items').columnInfo('quantity')).type, childType);

  const [targets] = await knex.raw(`
    SELECT REFERENCED_TABLE_NAME AS parent, REFERENCED_COLUMN_NAME AS parent_column
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items'
      AND COLUMN_NAME = 'order_id' AND REFERENCED_TABLE_SCHEMA = DATABASE()
  `);
  assert.deepEqual(targets.map(row => [row.parent, row.parent_column]), [['orders', 'id']]);

  const rows = await knex('orders').join('order_items', 'orders.id', 'order_items.order_id')
    .select('orders.id', 'orders.amount', 'order_items.quantity');
  assert.deepEqual(rows.map(row => [row.id, Number(row.amount), Number(row.quantity)]), [[1, 120, 3]]);
  await assert.rejects(knex('order_items').insert({ order_id: 404, quantity: 1 }),
    { code: 'ER_NO_REFERENCED_ROW_2' });

  await knex('orders').insert({ id: 2, amount: 10 });
  await knex('order_items').insert({ order_id: 2, quantity: 1 });
  assert.equal(await knex('orders').where({ id: 2 }).del(), 1);
  assert.equal(await knex('order_items').where({ order_id: 2 }).first(), undefined);
};
