import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import { stripe } from "../src/config/stripe.js";
import { requireTestDatabase } from "./helpers/requireTestDatabase.js";
import { productionCounts } from "../src/services/production.service.js";
import { deliveryCounts } from "../src/services/delivery.service.js";
import { confirmPaidCheckoutSession } from "../src/services/checkoutPaymentConfirmation.service.js";

after(() => pool.end());

test("administrative rejection safely refunds unaccepted paid orders", { timeout: 30000 }, async t => {
  await requireTestDatabase(pool);
  const old = { flag: process.env.ENABLE_ADMIN_REFUNDS, secret: process.env.STRIPE_WEBHOOK_SECRET };
  process.env.ENABLE_ADMIN_REFUNDS = "true";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_refund_local_validation";
  const fixtures = [], users = [], agents = [];
  const refunds = new Map(), createCounts = new Map();
  let behavior = "success", earlyWebhook = false;

  async function sendWebhook(refund, expected = 200, signature = null, type = "refund.updated") {
    const payload = JSON.stringify({ id: `evt_${randomUUID()}`, type, data: { object: refund } });
    const header = signature ?? stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    return request(app).post("/api/payments/webhook").set("Content-Type", "application/json")
      .set("Stripe-Signature", header).send(payload).expect(expected);
  }
  t.mock.method(stripe.paymentIntents, "retrieve", async id => ({
    id, currency: "usd", amount_received: 1200, status: "succeeded", livemode: false
  }));
  t.mock.method(stripe.refunds, "list", async ({ payment_intent }) => ({
    data: refunds.has(payment_intent) ? [refunds.get(payment_intent)] : [], has_more: false
  }));
  t.mock.method(stripe.refunds, "retrieve", async id => [...refunds.values()].find(r => r.id === id));
  t.mock.method(stripe.refunds, "create", async (params, options) => {
    assert.equal(params.amount, 1200);
    assert.equal(options.idempotencyKey, `order-refund-${params.metadata.order_id}`);
    if (!refunds.has(params.payment_intent)) {
      createCounts.set(params.payment_intent, (createCounts.get(params.payment_intent) ?? 0) + 1);
      refunds.set(params.payment_intent, {
        id: `re_${randomUUID().replaceAll("-", "")}`, status: behavior === "pending" ? "pending" : "succeeded",
        payment_intent: params.payment_intent, amount: params.amount, currency: "usd", metadata: params.metadata
      });
    }
    const refund = refunds.get(params.payment_intent);
    if (earlyWebhook) await sendWebhook(refund,200,null,"refund.created");
    if (behavior === "lost-response") throw new Error("Stripe response lost after creation");
    return refund;
  });

  async function login(role) {
    const agent = request.agent(app), email = `refund-${randomUUID()}@example.com`, password = "RefundValidationPassword123!";
    agents.push(agent);
    const r = await agent.post("/api/auth/register").send({ firstName: "Refund", lastName: "Tester", email, password, phone: "5551234567" }).expect(201);
    const id = r.body.user.id; users.push(id);
    if (role === "admin") await pool.query("UPDATE users SET role='admin' WHERE id=$1", [id]);
    await agent.post("/api/auth/login").send({ email, password }).expect(200);
    return { agent, id, csrf: (await agent.get("/api/cart/csrf-token").expect(200)).body.csrf_token };
  }
  async function fixture(orderStatus = "pending", paymentStatus = "paid", method = "pickup") {
    const f = { variants: [], products: [], intent: `pi_${randomUUID().replaceAll("-", "")}` };
    fixtures.push(f);
    f.category = (await pool.query("INSERT INTO categories (name) VALUES ($1) RETURNING id", [`Refund ${randomUUID()}`])).rows[0].id;
    f.cart = (await pool.query("INSERT INTO cart (guest_token_hash) VALUES ($1) RETURNING id", [randomUUID()])).rows[0].id;
    f.order = (await pool.query(`INSERT INTO orders (guest_cart_id,shipping_name,shipping_street,shipping_street_number,
      shipping_city,shipping_state,shipping_zip_code,delivery_date,subtotal,shipping_cost,tax_amount,total,payment_status,
      order_status,fulfillment_method,fulfillment_at,service_date)
      VALUES ($1,'Refund Tester','Test Street','123','Houston','TX','77001',NOW()+INTERVAL '5 days',12,0,0,12,$2,$3,
      $4,NOW()+INTERVAL '5 days',CURRENT_DATE+5) RETURNING id,service_date::text`, [f.cart, paymentStatus, orderStatus, method])).rows[0].id;
    f.date = (await pool.query("SELECT service_date::text FROM orders WHERE id=$1", [f.order])).rows[0].service_date;
    for (const mode of ["stock", "made_to_order"]) {
      const p = (await pool.query("INSERT INTO products (name,price,stock,category_id,inventory_mode) VALUES ($1,6,10,$2,$3) RETURNING id", [`Refund ${mode}`, f.category, mode])).rows[0].id;
      f.products.push(p);
      const v = (await pool.query("INSERT INTO product_variants (product_id,price,stock,production_points) VALUES ($1,6,$2,2) RETURNING id", [p, mode === "stock" ? 9 : 0])).rows[0].id;
      f.variants.push(v);
      await pool.query(`INSERT INTO order_items (order_id,product_id,variant_id,quantity,unit_price,product_name_snapshot,inventory_mode,production_points)
        VALUES ($1,$2,$3,1,6,'Refund item',$4,$5)`, [f.order, p, v, mode, mode === "stock" ? 0 : 2]);
      await pool.query(`INSERT INTO inventory_reservations (order_id,variant_id,quantity,status,expires_at,inventory_mode)
        VALUES ($1,$2,1,'committed',NOW()+INTERVAL '2 hours',$3)`, [f.order, v, mode]);
    }
    await pool.query(`INSERT INTO production_reservations (order_id,service_date,points,policy_version,status,expires_at)
      VALUES ($1,$2,2,1,'committed',NOW()+INTERVAL '2 hours')`, [f.order, f.date]);
    f.sessionId = `cs_test_${randomUUID().replaceAll("-", "")}`;
    f.payment = (await pool.query(`INSERT INTO payments (order_id,stripe_payment_id,stripe_payment_intent_id,amount,status)
      VALUES ($1,$2,$3,12,'succeeded') RETURNING id`, [f.order, f.sessionId, f.intent])).rows[0].id;
    f.attempt = (await pool.query(`INSERT INTO checkout_attempts (order_id,payment_id,stripe_session_id,status,expires_at)
      VALUES ($1,$2,$3,'completed',NOW()+INTERVAL '2 hours') RETURNING id`, [f.order, f.payment, f.sessionId])).rows[0].id;
    return f;
  }
  const state = async f => (await pool.query("SELECT payment_status,order_status FROM orders WHERE id=$1", [f.order])).rows[0];
  const stock = async f => (await pool.query("SELECT stock FROM product_variants WHERE id=ANY($1::uuid[]) ORDER BY id", [f.variants])).rows.map(r => r.stock).sort((a,b) => a-b);
  const used = async f => (await productionCounts(pool, f.date, f.date)).get(f.date) ?? 0;
  const deliveries = async f => (await deliveryCounts(pool, f.date, f.date)).get(f.date) ?? 0;
  let admin, customer;
  try {
    admin = await login("admin"); customer = await login("customer");
    const reject = (f, reason = "Cannot fulfill this order") => admin.agent.post(`/api/admin/orders/${f.order}/reject`)
      .set("X-CSRF-Token", admin.csrf).send({ reason });

    await t.test("requires admin, CSRF, feature flag, valid reason and unaccepted paid state", async () => {
      const f = await fixture();
      const url = `/api/admin/orders/${f.order}/reject`;
      await request(app).post(url).send({ reason: "Test" }).expect(401);
      await customer.agent.post(url).set("X-CSRF-Token", customer.csrf).send({ reason: "Test" }).expect(403);
      await admin.agent.post(url).send({ reason: "Test" }).expect(403);
      await reject(f, " ").expect(400);
      process.env.ENABLE_ADMIN_REFUNDS = "false";
      await reject(f).expect(503);
      process.env.ENABLE_ADMIN_REFUNDS = "true";
      for (const status of ["confirmed", "preparing", "completed"]) await reject(await fixture(status)).expect(409);
      await reject(await fixture("pending", "pending")).expect(409);
      assert.equal(refunds.size, 0);
      const review = (await admin.agent.get(`/api/admin/orders/${f.order}/refund-review`).expect(200)).body.review;
      assert.equal(review.can_reject, true);
      assert.equal(review.refunds_enabled, true);
    });

    await t.test("early and duplicate refund webhooks return resources once; late payment cannot undo refund", async () => {
      const f = await fixture("pending", "paid", "delivery"), before = await used(f), deliveryBefore = await deliveries(f);
      earlyWebhook = true;
      const result = await reject(f).expect(200);
      earlyWebhook = false;
      assert.deepEqual(result.body.order, { id: f.order, payment_status: "refunded", order_status: "cancelled" });
      const refund = refunds.get(f.intent);
      await sendWebhook(refund);
      await sendWebhook({ ...refund, status: "pending" });
      await reject(f).expect(200);
      assert.deepEqual(await stock(f), [0,10]);
      assert.equal(await used(f), before - 2);
      assert.equal(await deliveries(f), deliveryBefore - 1);
      assert.equal(createCounts.get(f.intent), 1);
      const rr = (await pool.query("SELECT requested_by,reason,resources_returned_at FROM refund_requests WHERE order_id=$1", [f.order])).rows[0];
      assert.equal(rr.requested_by, admin.id);
      assert.equal(rr.reason, "Cannot fulfill this order");
      assert.ok(rr.resources_returned_at);
      assert.equal((await pool.query("SELECT status FROM payments WHERE id=$1", [f.payment])).rows[0].status, "refunded");
      assert.equal((await confirmPaidCheckoutSession({ id:f.sessionId,object:"checkout.session",mode:"payment",status:"complete",
        payment_status:"paid",payment_intent:f.intent,currency:"usd",amount_total:1200,
        metadata:{order_id:f.order,checkout_attempt_id:f.attempt} })).status, "already_completed");
      assert.deepEqual(await stock(f), [0,10]);
      assert.equal(await used(f), before - 2);
    });

    await t.test("lost Stripe responses preserve the request and recover without a second refund", async () => {
      const f = await fixture(), before = await used(f);
      behavior = "lost-response";
      await reject(f).expect(202);
      assert.deepEqual(await state(f), {payment_status:"refund_pending",order_status:"refund_pending"});
      assert.deepEqual(await stock(f), [0,9]);
      assert.equal(await used(f), before);
      await admin.agent.patch(`/api/admin/orders/${f.order}/accept`).set("X-CSRF-Token",admin.csrf).expect(409);
      behavior = "success";
      await Promise.all([reject(f).expect(200), reject(f).expect(200)]);
      assert.equal(createCounts.get(f.intent), 1);
      assert.deepEqual(await stock(f), [0,10]);
      assert.equal(await used(f), before-2);
      assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM refund_requests WHERE order_id=$1",[f.order])).rows[0].n,1);
    });

    await t.test("pending/failed refunds retain resources; signed mismatches cannot mark the order refunded", async () => {
      const f = await fixture("pending", "paid", "delivery"), before = await used(f), deliveryBefore = await deliveries(f);
      behavior = "pending";
      await reject(f).expect(202);
      const refund = refunds.get(f.intent);
      await sendWebhook(refund,400,"invalid");
      await sendWebhook({...refund,amount:1199},400);
      await sendWebhook({...refund,payment_intent:"pi_wrong"},400);
      await sendWebhook({...refund,status:"failed"},200,null,"refund.failed");
      await sendWebhook(refund);
      await sendWebhook({...refund,status:"succeeded"});
      assert.deepEqual(await stock(f), [0,9]);
      assert.equal(await used(f),before);
      assert.equal(await deliveries(f),deliveryBefore);
      assert.equal((await state(f)).payment_status,"refund_pending");
      const review=(await admin.agent.get(`/api/admin/orders/${f.order}/refund-review`).expect(200)).body.review;
      assert.equal(review.refund_status,"failed");
      assert.equal(review.can_retry,false);
      behavior="success";
    });

    await t.test("acceptance racing rejection has one winner", async () => {
      const f=await fixture();
      const [accepted,rejected]=await Promise.all([
        admin.agent.patch(`/api/admin/orders/${f.order}/accept`).set("X-CSRF-Token",admin.csrf),
        reject(f)
      ]);
      assert.deepEqual([accepted.status,rejected.status].sort((a,b)=>a-b),[200,409]);
      const order=await state(f);
      if(accepted.status===200){
        assert.deepEqual(order,{payment_status:"paid",order_status:"confirmed"});
        assert.equal(createCounts.get(f.intent),undefined);
      }else{
        assert.deepEqual(order,{payment_status:"refunded",order_status:"cancelled"});
        assert.equal(createCounts.get(f.intent),1);
      }
    });

    await t.test("a refund returned after success requires manual review without reversing returned resources", async () => {
      const f=await fixture(), before=await used(f);
      await reject(f).expect(200);
      const refund=refunds.get(f.intent);
      await sendWebhook({...refund,status:"failed"},200,null,"refund.failed");
      await sendWebhook({...refund,status:"failed"},200,null,"refund.failed");
      await sendWebhook(refund);
      assert.deepEqual(await state(f),{payment_status:"refund_pending",order_status:"cancelled"});
      assert.deepEqual(await stock(f),[0,10]);
      assert.equal(await used(f),before-2);
      assert.equal(createCounts.get(f.intent),1);
      const review=(await admin.agent.get(`/api/admin/orders/${f.order}/refund-review`).expect(200)).body.review;
      assert.equal(review.review_status,"manual_review");
      assert.equal(review.can_retry,false);
      assert.match(review.last_error,/after prior success/);
    });
  } finally {
    if(old.flag===undefined)delete process.env.ENABLE_ADMIN_REFUNDS;else process.env.ENABLE_ADMIN_REFUNDS=old.flag;
    if(old.secret===undefined)delete process.env.STRIPE_WEBHOOK_SECRET;else process.env.STRIPE_WEBHOOK_SECRET=old.secret;
    for(const agent of agents)await agent.post("/api/auth/logout");
    for(const f of fixtures.reverse()){
      if(f.order){
        for(const table of ["order_notification_outbox","refund_requests","checkout_attempts","payments","inventory_reservations","order_items","production_reservations"])
          await pool.query(`DELETE FROM ${table} WHERE order_id=$1`,[f.order]);
        await pool.query("DELETE FROM orders WHERE id=$1",[f.order]);
      }
      for(const id of f.variants)await pool.query("DELETE FROM product_variants WHERE id=$1",[id]);
      for(const id of f.products)await pool.query("DELETE FROM products WHERE id=$1",[id]);
      if(f.cart)await pool.query("DELETE FROM cart WHERE id=$1",[f.cart]);
      if(f.category)await pool.query("DELETE FROM categories WHERE id=$1",[f.category]);
    }
    for(const id of users)await pool.query("UPDATE users SET deleted_at=NOW() WHERE id=$1",[id]);
  }
});
