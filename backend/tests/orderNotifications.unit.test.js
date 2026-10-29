import test from 'node:test';
import assert from 'node:assert/strict';
import { processOrderNotificationBatch } from '../src/services/orderNotifications.service.js';

test('notification sending is off by default', async () => {
  const previous = process.env.ENABLE_TRANSACTIONAL_NOTIFICATIONS;
  delete process.env.ENABLE_TRANSACTIONAL_NOTIFICATIONS;
  try {
    const out = await processOrderNotificationBatch({ db: { query: () => { throw Error('DB should not be touched'); } }});
    assert.deepEqual(out, { disabled: true, processed: 0, sent: 0, failed: 0 });
  } finally {
    if (previous === undefined) delete process.env.ENABLE_TRANSACTIONAL_NOTIFICATIONS;
    else process.env.ENABLE_TRANSACTIONAL_NOTIFICATIONS = previous;
  }
});

test('worker marks one claimed notification sent', async () => {
  const previous = process.env.ENABLE_TRANSACTIONAL_NOTIFICATIONS;
  process.env.ENABLE_TRANSACTIONAL_NOTIFICATIONS = 'true';
  const queries = [];
  const db = { async query(sql) {
    queries.push(sql);
    if (sql.includes('WITH selected')) return { rows: queries.filter(q => q.includes('WITH selected')).length === 1 ? [{id:'n1',order_id:'o1',event_type:'order_paid',channel:'email',attempts:1}] : [] };
    if (sql.includes('SELECT o.customer_email')) return {rowCount:1,rows:[{customer_email:'test@example.com',shipping_name:'Customer'}]};
    return {rowCount:1,rows:[]};
  }};
  let called = 0;
  try {
    const result = await processOrderNotificationBatch({db, send: async () => {called++;},max:2});
    assert.equal(result.sent, 1);
    assert.equal(called, 1);
    assert(queries.some(sql => sql.includes("status = 'sent'")));
  } finally {
    if (previous === undefined) delete process.env.ENABLE_TRANSACTIONAL_NOTIFICATIONS;
    else process.env.ENABLE_TRANSACTIONAL_NOTIFICATIONS = previous;
  }
});
