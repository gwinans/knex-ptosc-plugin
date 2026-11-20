const assert = require('node:assert/strict');
const knex = require('knex')(require('./knexfile.cjs'));

async function verify() {
  const exists = await knex.schema.hasTable('widgets');
  if (process.argv[2] === 'down') {
    assert.equal(exists, false);
    assert.equal(await knex.schema.hasTable('orders'), false);
    assert.equal(await knex.schema.hasTable('order_items'), false);
    return;
  }
  assert.equal(exists, true);
  const columns = await knex('widgets').columnInfo();
  assert.equal(columns.qty.type, 'bigint');
  assert.equal(columns.priority.type, 'bigint');
  const [indexes] = await knex.raw('SHOW INDEX FROM widgets WHERE Key_name = ?', ['qty_ix']);
  assert.equal(indexes[0].Column_name, 'qty');
  assert.equal(Number((await knex('widgets').first()).qty), 7);
  const lock = await knex('knex_migrations_lock').first();
  assert.equal(lock.is_locked, 0);
}
verify().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => knex.destroy());
