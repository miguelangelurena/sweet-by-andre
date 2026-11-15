import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/config/database.js";
import { requireTestDatabase } from "./helpers/requireTestDatabase.js";
import { processOrderNotificationBatch } from "../src/services/orderNotifications.service.js";

after(() => pool.end());

test("transactional outbox safely processes order emails without contacting customers", { timeout: 20000 }, async t => {
  await requireTestDatabase(pool);
  const email = `notification-${randomUUID()}@example.com`, fixtures = [];
  const env = { ENABLE_TRANSACTIONAL_NOTIFICATIONS: "true", APP_ENV: "staging",
    BREVO_API_KEY: "mock-provider-key", BREVO_SENDER_EMAIL: "bakery@example.com",
    TRANSACTIONAL_EMAIL_ALLOWLIST: email, NOTIFICATIONS_START_AT: new Date(Date.now()-60_000).toISOString() };
  const batch = options => processOrderNotificationBatch({ db: pool, env, ...options });
  async function fixture(recipient = email) {
    const f = {}; fixtures.push(f);
    f.cart = (await pool.query("INSERT INTO cart (guest_token_hash) VALUES ($1) RETURNING id", [randomUUID()])).rows[0].id;
    f.order = (await pool.query(`INSERT INTO orders (guest_cart_id,shipping_name,shipping_street,shipping_street_number,
      shipping_city,shipping_state,shipping_zip_code,delivery_date,subtotal,shipping_cost,tax_amount,total,
      payment_status,order_status,customer_email,sms_opt_in,customer_phone)
      VALUES ($1,'Mail Tester','Test Street','123','Houston','TX','77001',NOW()+INTERVAL '5 days',12,0,0,12,
      'pending','pending',$2,TRUE,'5551234567') RETURNING id`, [f.cart,recipient])).rows[0].id;
    return f;
  }
  const update = (f, payment, status) => pool.query("UPDATE orders SET payment_status=$2,order_status=$3 WHERE id=$1", [f.order,payment,status]);
  const jobs = async f => (await pool.query("SELECT * FROM order_notification_outbox WHERE order_id=$1 ORDER BY event_type,channel", [f.order])).rows;
  const paid = async () => { const f = await fixture(); await update(f,"paid","pending"); return f; };
  // Each subtest isolates its candidates without deleting event history.
  const finish = async () => { for (const f of fixtures) if(f.order) await pool.query("UPDATE order_notification_outbox SET status='skipped' WHERE order_id=$1 AND status<>'sent'",[f.order]); };
  try {
    await t.test("rollback queues nothing; repeated lifecycle/refund updates queue one email per event", async () => {
      const f = await fixture(), client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE orders SET payment_status='paid' WHERE id=$1",[f.order]);
        await client.query("ROLLBACK");
      } finally { client.release(); }
      assert.equal((await jobs(f)).length,0);
      for(const status of ["pending","confirmed","preparing","ready","completed"]) await update(f,"paid",status);
      await update(f,"paid","completed");
      assert.deepEqual((await jobs(f)).filter(j=>j.channel==="email").map(j=>j.event_type),
        ["order_completed","order_confirmed","order_paid","order_ready"]);
      const r=await paid();
      await update(r,"refund_pending","refund_pending");
      await update(r,"refunded","cancelled");
      await update(r,"refunded","cancelled");
      const rows=await jobs(r);
      assert.deepEqual(rows.filter(j=>j.channel==="email").map(j=>j.event_type),["order_paid","order_refunded","order_rejected"]);
      assert.deepEqual(rows.filter(j=>j.channel==="sms").map(j=>j.event_type),["order_paid"]);
      await finish();
    });

    await t.test("only the latest relevant notices send; rejection precedes refund confirmation", async () => {
      const f=await paid();
      await update(f,"refund_pending","refund_pending");
      await update(f,"refunded","cancelled");
      const sent=[];
      const result=await batch({send:async row=>{sent.push(row.event_type);return{messageId:`mock-${row.id}`};}});
      assert.equal(result.sent,2);
      assert.deepEqual(sent,["order_rejected","order_refunded"]);
      const rows=await jobs(f);
      assert.equal(rows.find(j=>j.event_type==="order_paid"&&j.channel==="email").status,"skipped");
      assert.ok(rows.filter(j=>j.status==="sent").every(j=>j.provider_message_id));
      assert.equal((await batch({send:async()=>{throw new Error("Duplicate send");}})).processed,0);
      await finish();
    });

    await t.test("concurrent workers cannot send the same job or overtake its in-flight predecessor", async () => {
      const f=await paid();
      let entered, release;
      const started=new Promise(resolve=>{entered=resolve;}), pending=new Promise(resolve=>{release=resolve;});
      const first=batch({max:1,send:async()=>{entered();await pending;}});
      await started;
      try {
        await update(f,"paid","confirmed");
        assert.equal((await batch({send:async()=>{throw new Error("Overlapping send");}})).processed,0);
      } finally {release();}
      assert.equal((await first).sent,1);
      const sent=[];
      assert.equal((await batch({send:async row=>{sent.push(row.event_type);}})).sent,1);
      assert.deepEqual(sent,["order_confirmed"]);
      await finish();
    });

    await t.test("cutoff, allowlist and disabled SMS prevent accidental historical/test delivery", async () => {
      const old=await paid();
      await pool.query("UPDATE order_notification_outbox SET created_at=$2::timestamptz-INTERVAL '1 day' WHERE order_id=$1",[old.order,env.NOTIFICATIONS_START_AT]);
      const other=await fixture("other-recipient@example.com");await update(other,"paid","pending");
      const current=await paid(), sent=[];
      assert.equal((await batch({send:async row=>{sent.push(row);}})).sent,1);
      assert.equal(sent[0].order_id,current.order);
      assert.equal(sent[0].channel,"email");
      assert.equal((await jobs(old)).filter(j=>j.status==="sent").length,0);
      assert.equal((await jobs(other)).filter(j=>j.status==="sent").length,0);
      await finish();
    });

    await t.test("rate limiting retries with backoff but accepted jobs do not send again", async () => {
      const f=await paid();
      let calls=0;
      const fetchImpl=async()=>{calls++;return calls===1 ? new Response("rate limited",{status:429}) :
        new Response(JSON.stringify({messageId:"accepted-after-retry"}),{status:201});};
      assert.equal((await batch({fetchImpl})).failed,1);
      let job=(await jobs(f)).find(j=>j.channel==="email");
      assert.equal(job.retryable,true);assert.equal(job.attempts,1);
      assert.equal((await batch({fetchImpl})).processed,0);
      await pool.query("UPDATE order_notification_outbox SET next_attempt_at=NOW() WHERE id=$1",[job.id]);
      assert.equal((await batch({fetchImpl})).sent,1);
      job=(await jobs(f)).find(j=>j.channel==="email");
      assert.equal(job.attempts,2);assert.equal(job.provider_message_id,"accepted-after-retry");
      assert.equal((await batch({fetchImpl})).processed,0);assert.equal(calls,2);
      await finish();
    });

    await t.test("unknown provider outcomes, permanent rejection and interrupted workers never auto-resend", async () => {
      for(const scenario of ["timeout","permanent","interrupted"]){
        const f=await paid();
        if(scenario==="interrupted") await pool.query(`UPDATE order_notification_outbox SET status='sending',attempts=1,
          claimed_at=NOW()-INTERVAL '16 minutes',claim_token=gen_random_uuid() WHERE order_id=$1 AND channel='email'`,[f.order]);
        let calls=0;
        const fetchImpl=async()=>{calls++;if(scenario==="timeout")throw new Error("secret-and-private-recipient");return new Response("private body",{status:400});};
        await batch({fetchImpl});
        const job=(await jobs(f)).find(j=>j.channel==="email");
        assert.equal(job.status,scenario==="permanent"?"failed":"uncertain");
        assert.equal(job.retryable,false);assert.equal(job.last_error.includes("private"),false);
        assert.equal((await batch({fetchImpl})).processed,0);
        assert.equal(calls,scenario==="interrupted"?0:1);
        await finish();
      }
    });
  } finally {
    for(const f of fixtures.reverse()){
      if(f.order){await pool.query("DELETE FROM order_notification_outbox WHERE order_id=$1",[f.order]);await pool.query("DELETE FROM orders WHERE id=$1",[f.order]);}
      if(f.cart)await pool.query("DELETE FROM cart WHERE id=$1",[f.cart]);
    }
  }
});
