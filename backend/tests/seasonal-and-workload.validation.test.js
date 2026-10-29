import test from 'node:test';
import assert from 'node:assert/strict';
import { updateAdminSeasonalCollection } from '../src/controllers/seasonal.controllers.js';
import { getAdminOrders } from '../src/controllers/admin-order.controller.js';
function response() {
  return { statusCode: 200, jsonData: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.jsonData = data; return this; } };
}
test('rejects invalid seasonal slug before database access', async () => {
  const res=response();
  await updateAdminSeasonalCollection({params:{slug:'arbitrary'}, body:{title:'Hello',description:'',is_published:true, product_ids:[]}},res);
  assert.equal(res.statusCode,400);
});
test('rejects duplicate or malformed seasonal product IDs', async () => {
  const res=response();
  await updateAdminSeasonalCollection({params:{slug:'christmas'}, body:{title:'Christmas',description:'',is_published:true, product_ids:['bad-id']}},res);
  assert.equal(res.statusCode,400);
});
test('rejects unapproved delivery filter', async () => {
  const res=response();
  await getAdminOrders({query:{delivery_window:'all-time'}},res);
  assert.equal(res.statusCode,400);
});
test('rejects invalid workload filter', async () => {
  const res=response();
  await getAdminOrders({query:{workload:'everything'}},res);
  assert.equal(res.statusCode,400);
});
