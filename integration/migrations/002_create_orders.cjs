exports.up = async knex => {
  await knex.schema.createTable('orders', table => {
    table.increments('id');
    table.integer('amount').notNullable();
  });
  await knex.schema.createTable('order_items', table => {
    table.increments('id');
    table.integer('order_id').unsigned().notNullable()
      .references('id').inTable('orders').onDelete('CASCADE');
    table.integer('quantity').notNullable();
  });
  await knex('orders').insert({ id: 1, amount: 120 });
  await knex('order_items').insert({ id: 1, order_id: 1, quantity: 3 });
};

exports.down = async knex => {
  await knex.schema.dropTable('order_items');
  await knex.schema.dropTable('orders');
};
