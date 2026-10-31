import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import { stripe } from "../src/config/stripe.js";
import { roadDistance } from "../src/services/roadDistance.service.js";
import { houstonDate, scheduleForDate } from "../src/services/deliveryPolicy.service.js";
import { requireTestDatabase } from "./helpers/requireTestDatabase.js";

after(() => pool.end());

test("admin scheduling, trusted quotes, last-slot concurrency, Stripe fees and expiration work together", { timeout: 30000 }, async (t) => {
  await requireTestDatabase(pool);
  const original = (await pool.query("SELECT config FROM delivery_settings WHERE id=TRUE")).rows[0].config;
  const oldKey = process.env.GOOGLE_ROUTES_API_KEY, oldSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.GOOGLE_ROUTES_API_KEY = "local-mocked-routing-only";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_delivery_test";
  const ids = { carts: [], orders: [] }, admin = request.agent(app);
  let settings, csrf, meters = 4828, routeCalls = 0, session;
  t.mock.method(roadDistance, "measure", async (origin, destination) => {
    routeCalls++; assert.equal(origin, "Private test origin, Katy TX"); assert.match(destination, /TX 77449/); return meters;
  });
  const createdAmounts = [];
  t.mock.method(stripe.checkout.sessions, "create", async (params) => {
    createdAmounts.push(params.line_items[0].price_data.unit_amount);
    session = { id: `cs_test_${randomUUID().replaceAll("-", "")}`, object: "checkout.session", mode: "payment",
      status: "open", payment_status: "unpaid", currency: "usd", amount_total: params.line_items[0].price_data.unit_amount,
      expires_at: params.expires_at, metadata: params.metadata, url: "https://checkout.stripe.com/c/pay/delivery-test" };
    return { ...session };
  });
  t.mock.method(stripe.checkout.sessions, "retrieve", async (id) => { assert.equal(id, session.id); return { ...session }; });
  const address = { shipping_street_number: "123", shipping_street: "Test Road", shipping_unit: "", shipping_city: "Katy", shipping_state: "TX", shipping_zip_code: "77449" };
  const future = new Date(); future.setUTCDate(future.getUTCDate() + 6);
  const date = houstonDate(future);
  const base = { ...address, fulfillment_method: "delivery", fulfillment_date: date,
    shipping_name: "Delivery Tester", customer_email: "delivery@example.com", customer_phone: "5551234567", sms_opt_in: false };

  async function buyer(quantity = 3, variantId = ids.variant) {
    const agent = request.agent(app);
    const cart = await agent.post("/api/guest/cart").expect(201); ids.carts.push(cart.body.cart.id);
    const token = (await agent.get("/api/guest/cart/csrf-token").expect(200)).body.csrf_token;
    await agent.post("/api/guest/cart/items").set("X-CSRF-Token", token).send({ variant_id: variantId, quantity }).expect(200);
    return { agent, token, cartId: cart.body.cart.id };
  }
  const quote = (b, data = address) => b.agent.post("/api/guest/delivery/quote").set("X-CSRF-Token", b.token).send(data);
  async function order(b, changes = {}) {
    const result = await b.agent.post("/api/guest/orders").set("X-CSRF-Token", b.token)
      .set("Idempotency-Key", randomUUID()).send({ ...base, ...changes });
    if (result.status === 201) ids.orders.push(result.body.order.id);
    return result;
  }
  async function save(config) {
    const result = await admin.put("/api/admin/delivery").set("X-CSRF-Token", csrf).send({ version: settings.version, config }).expect(200);
    settings = result.body.settings;
  }
  const checkout = (b, orderId) => b.agent.post("/api/guest/payments/checkout").set("X-CSRF-Token", b.token).send({ order_id: orderId });
  async function webhook(type, changes) {
    const payload = JSON.stringify({ id: `evt_${randomUUID().replaceAll("-", "")}`, type, object: "event", data: { object: { ...session, ...changes } } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    return request(app).post("/api/payments/webhook").set("Content-Type", "application/json").set("Stripe-Signature", signature).send(payload);
  }
  try {
    await request(app).get("/api/admin/delivery").expect(401);
    const email = `delivery-admin-${randomUUID()}@example.com`, password = "LocalDeliveryPassword123!";
    ids.user = (await admin.post("/api/auth/register").send({ firstName: "Delivery", lastName: "Admin", email, phone: "5551234567", password }).expect(201)).body.user.id;
    await admin.post("/api/auth/login").send({ email, password }).expect(200);
    await admin.get("/api/admin/delivery").expect(403);
    await pool.query("UPDATE users SET role='admin' WHERE id=$1", [ids.user]);
    settings = (await admin.get("/api/admin/delivery").expect(200)).body.settings;
    csrf = (await admin.get("/api/cart/csrf-token").expect(200)).body.csrf_token;
    await admin.put("/api/admin/delivery").send(settings).expect(403);
    const previousVersion = settings.version;
    await save({ ...settings.config, delivery_enabled: true, origin_address: "Private test origin, Katy TX", daily_limit: 1 });
    await admin.put("/api/admin/delivery").set("X-CSRF-Token", csrf).send({ ...settings, version: previousVersion }).expect(409);
    const options = (await request(app).get("/api/delivery/options").expect(200)).body.options;
    assert.equal(options.delivery_available, true);
    assert.ok(!JSON.stringify(options).includes("Private test origin"));
    assert.ok(!Object.hasOwn(options, "origin_address"));
    base.fulfillment_time = scheduleForDate(settings.config, date).start;
    ids.category = (await pool.query("INSERT INTO categories (name) VALUES ($1) RETURNING id", [`Delivery ${randomUUID()}`])).rows[0].id;
    ids.product = (await pool.query("INSERT INTO products (name,price,stock,category_id) VALUES ('Delivery Cookies',6,100,$1) RETURNING id", [ids.category])).rows[0].id;
    ids.variant = (await pool.query("INSERT INTO product_variants (product_id,price,stock) VALUES ($1,6,100) RETURNING id", [ids.product])).rows[0].id;
    // Different stock rows: the delivery settings lock, not inventory locking,
    // must serialize the last-place race.
    ids.productB = (await pool.query("INSERT INTO products (name,price,stock,category_id) VALUES ('Other Delivery Cookies',6,100,$1) RETURNING id", [ids.category])).rows[0].id;
    ids.variantB = (await pool.query("INSERT INTO product_variants (product_id,price,stock) VALUES ($1,6,100) RETURNING id", [ids.productB])).rows[0].id;
    const a = await buyer(), b = await buyer(3, ids.variantB), small = await buyer(1);
    await a.agent.post("/api/guest/delivery/quote").send(address).expect(403);
    let qa = (await quote(a).expect(200)).body.quote;
    assert.equal(qa.fee_cents, 500); assert.equal(qa.distance_meters, 4828);
    await quote(a).expect(200); assert.equal(routeCalls, 1, "same-address quotes are cached");
    assert.equal((await order(b, { delivery_quote_id: qa.id })).body.code, "DELIVERY_QUOTE_EXPIRED");
    assert.equal((await order(a, { delivery_quote_id: qa.id, shipping_street_number: "456" })).body.code, "DELIVERY_QUOTE_EXPIRED");
    assert.equal((await order(small, { delivery_quote_id: qa.id })).body.code, "DELIVERY_MINIMUM");
    const pickup = await order(small, { fulfillment_method: "pickup", fulfillment_time: "12:00", shipping_street: "", shipping_city: "", shipping_zip_code: "" });
    assert.equal(pickup.status, 201); assert.equal(pickup.body.order.fulfillment_method, "pickup"); assert.equal(Number(pickup.body.order.shipping_cost), 0);
    await save({ ...settings.config, minimum_scope: "all" });
    assert.equal((await order(small, { fulfillment_method: "pickup", fulfillment_time: "12:00" })).body.code, "DELIVERY_MINIMUM");
    await save({ ...settings.config, minimum_scope: "delivery", date_overrides: [{ date, closed: true, start: null, end: null, daily_limit: null, note: "Private closure" }] });
    assert.equal((await order(a, { delivery_quote_id: qa.id })).body.code, "DELIVERY_CLOSED");
    assert.ok(!JSON.stringify((await request(app).get("/api/delivery/options")).body).includes("Private closure"));
    await save({ ...settings.config, date_overrides: [] });
    meters = 24141;
    assert.equal((await quote(b).expect(422)).body.code, "DELIVERY_OUTSIDE_AREA");
    meters = 4828;
    qa = (await quote(a).expect(200)).body.quote;
    const qb = (await quote(b).expect(200)).body.quote;
    const raced = await Promise.all([order(a, { delivery_quote_id: qa.id, shipping_cost: 0, distance_miles: 0 }), order(b, { delivery_quote_id: qb.id })]);
    assert.deepEqual(raced.map((r) => r.status).sort(), [201, 409]);
    assert.equal(raced.find((r) => r.status === 409).body.code, "DELIVERY_FULL");
    const winner = raced.find((r) => r.status === 201).body.order;
    assert.equal(Number(winner.shipping_cost), 5); assert.equal(Number(winner.total), 23);
    const loserBuyer = raced[0].status === 409 ? a : b, loserQuote = raced[0].status === 409 ? qa : qb;
    await admin.patch(`/api/admin/orders/${winner.id}/cancel-unpaid`).set("X-CSRF-Token", csrf).send({}).expect(200);
    const retried = await order(loserBuyer, { delivery_quote_id: loserQuote.id });
    assert.equal(retried.status, 201);
    // Changing rates does not change the total already promised on an order.
    await save({ ...settings.config, rates: settings.config.rates.map((rate, i) => i === 0 ? { ...rate, fee_cents: 900 } : rate) });
    await checkout(loserBuyer, retried.body.order.id).expect(200);
    assert.deepEqual(createdAmounts, [2300]);
    const held = (await pool.query("SELECT delivery_hold_until FROM orders WHERE id=$1", [retried.body.order.id])).rows[0];
    assert.ok(held.delivery_hold_until.getTime() > Date.now() + 110 * 60000);
    // An active payment retains its booked place if the admin blocks the date.
    await save({ ...settings.config, date_overrides: [{ date, closed: true, start: null, end: null, daily_limit: null, note: "" }] });
    await checkout(loserBuyer, retried.body.order.id).expect(200);
    assert.equal(createdAmounts.length, 1);
    const expired = await webhook("checkout.session.expired", { status: "expired", payment_status: "unpaid" });
    assert.equal(expired.status, 200);
    await save({ ...settings.config, date_overrides: [] });
    const nextQuote = (await quote(a).expect(200)).body.quote;
    assert.equal(nextQuote.fee_cents, 900);
    const next = await order(a, { delivery_quote_id: nextQuote.id }); assert.equal(next.status, 201);
    await checkout(a, next.body.order.id).expect(200);
    assert.deepEqual(createdAmounts, [2300, 2700]);
    assert.equal((await webhook("checkout.session.completed", { status: "complete", payment_status: "paid", payment_intent: `pi_${randomUUID().replaceAll("-", "")}` })).status, 200);
    await pool.query("UPDATE orders SET delivery_hold_until=NOW()-INTERVAL '1 hour' WHERE id=$1", [next.body.order.id]);
    const afterPaid = (await request(app).get("/api/delivery/options")).body.options;
    assert.equal(afterPaid.days.find((day) => day.date === date).remaining, 0, "paid deliveries keep their slot after hold expiration");
    assert.equal(Number((await pool.query("SELECT stock FROM product_variants WHERE id=$1", [ids.variant])).rows[0].stock), 97);
    const snapshot = (await admin.get(`/api/admin/orders/${next.body.order.id}`).expect(200)).body.order;
    assert.equal(snapshot.fulfillment_method, "delivery"); assert.equal(snapshot.delivery_distance_meters, 4828);
    console.log("Delivery verified: private origin, $14 delivery minimum, no pickup fee, one last-slot winner, trusted fees in Stripe and expiration release.");
  } finally {
    if (oldKey === undefined) delete process.env.GOOGLE_ROUTES_API_KEY; else process.env.GOOGLE_ROUTES_API_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = oldSecret;
    await pool.query("UPDATE delivery_settings SET config=$1,version=version+1 WHERE id=TRUE", [JSON.stringify(original)]);
    if (ids.user) await admin.post("/api/auth/logout");
    for (const orderId of ids.orders) {
      for (const table of ["order_notification_outbox", "order_creation_requests", "checkout_attempts", "payments", "inventory_reservations", "order_items"]) await pool.query(`DELETE FROM ${table} WHERE order_id=$1`, [orderId]);
      await pool.query("DELETE FROM orders WHERE id=$1", [orderId]);
    }
    for (const cartId of ids.carts) { await pool.query("DELETE FROM cart_items WHERE cart_id=$1", [cartId]); await pool.query("DELETE FROM cart WHERE id=$1", [cartId]); }
    if (ids.variantB) await pool.query("DELETE FROM product_variants WHERE id=$1", [ids.variantB]);
    if (ids.productB) await pool.query("DELETE FROM products WHERE id=$1", [ids.productB]);
    if (ids.variant) await pool.query("DELETE FROM product_variants WHERE id=$1", [ids.variant]);
    if (ids.product) await pool.query("DELETE FROM products WHERE id=$1", [ids.product]);
    if (ids.category) await pool.query("DELETE FROM categories WHERE id=$1", [ids.category]);
    if (ids.user) await pool.query("UPDATE users SET deleted_at=NOW() WHERE id=$1", [ids.user]);
  }
});
