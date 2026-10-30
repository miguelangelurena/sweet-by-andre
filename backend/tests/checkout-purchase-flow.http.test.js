// Run with npm run test:checkout. Uses real HTTP middleware and PostgreSQL,
// mocked Stripe sessions, and locally signed webhook events. No external calls.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import { stripe } from "../src/config/stripe.js";
import { requireTestDatabase } from "./helpers/requireTestDatabase.js";

after(() => pool.end());

test("guest purchase becomes a paid admin order and commits stock exactly once", { timeout: 20000 }, async (t) => {
  await requireTestDatabase(pool);
  const ids = {};
  const guest = request.agent(app);
  const admin = request.agent(app);
  const origin = process.env.FRONTEND_URL;
  const secret = "whsec_local_purchase_validation";
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  let session;
  let creations = 0;

  t.mock.method(stripe.checkout.sessions, "create", async (params) => {
    creations++;
    session = {
      id: `cs_test_${randomUUID().replaceAll("-", "")}`,
      object: "checkout.session", mode: "payment", status: "open",
      payment_status: "unpaid", currency: "usd",
      amount_total: params.line_items[0].price_data.unit_amount,
      expires_at: params.expires_at, metadata: params.metadata,
      url: "https://checkout.stripe.com/c/pay/local-validation",
    };
    return { ...session };
  });
  t.mock.method(stripe.checkout.sessions, "retrieve", async (id) => {
    assert.equal(id, session.id);
    return { ...session };
  });

  try {
    ids.category = (await pool.query("INSERT INTO categories (name) VALUES ($1) RETURNING id", [`Purchase ${randomUUID()}`])).rows[0].id;
    ids.product = (await pool.query("INSERT INTO products (name, price, stock, category_id) VALUES ('Purchase Test Cookies', 6, 15, $1) RETURNING id", [ids.category])).rows[0].id;
    ids.variant = (await pool.query("INSERT INTO product_variants (product_id, price, stock) VALUES ($1, 6, 15) RETURNING id", [ids.product])).rows[0].id;

    const cart = await guest.post("/api/guest/cart").set("Origin", origin).expect(201);
    ids.cart = cart.body.cart.id;
    const csrf = (await guest.get("/api/guest/cart/csrf-token").expect(200)).body.csrf_token;
    await guest.post("/api/guest/cart/items").set("Origin", origin)
      .set("X-CSRF-Token", csrf).send({ variant_id: ids.variant, quantity: 3 }).expect(200);

    const payload = {
      shipping_name: "Purchase Tester", shipping_street: "Test Street",
      shipping_street_number: "123", shipping_city: "Houston",
      shipping_state: "TX", shipping_zip_code: "77001",
      customer_email: "purchase-test@example.com", customer_phone: "5551234567",
      sms_opt_in: false, delivery_date: new Date(Date.now() + 5 * 86400000).toISOString(),
    };
    const key = randomUUID();
    const submit = () => guest.post("/api/guest/orders").set("Origin", origin)
      .set("X-CSRF-Token", csrf).set("Idempotency-Key", key).send(payload);
    const created = await submit().expect(201);
    ids.order = created.body.order.id;
    assert.equal(Number(created.body.order.total), 18);
    const repeated = await submit().expect(200);
    assert.equal(repeated.body.order.id, ids.order);

    const statusUrl = `/api/guest/orders/${ids.order}/status`;
    assert.equal((await guest.get(statusUrl).expect(200)).body.order.payment_status, "pending");
    await request(app).get(statusUrl).expect(401);
    const stranger = request.agent(app);
    ids.strangerCart = (await stranger.post("/api/guest/cart").set("Origin", origin).expect(201)).body.cart.id;
    await stranger.get(statusUrl).expect(404);

    const checkout = () => guest.post("/api/payments/checkout").set("Origin", origin)
      .set("X-CSRF-Token", csrf).send({ order_id: ids.order });
    const first = await checkout().expect(200);
    const resumed = await checkout().expect(200);
    assert.equal(first.body.checkoutUrl, session.url);
    assert.equal(resumed.body.checkoutUrl, session.url);
    assert.equal(creations, 1);
    assert.equal(session.amount_total, 1800);
    assert.equal(Number((await pool.query("SELECT stock FROM product_variants WHERE id = $1", [ids.variant])).rows[0].stock), 15);

    // Admin must see the same order, but cannot fulfill it before payment.
    const email = `purchase-admin-${randomUUID()}@example.com`;
    const password = "LocalValidationPassword123!";
    const registered = await admin.post("/api/auth/register").send({
      firstName: "Purchase", lastName: "Admin", email, phone: "5551234567", password,
    }).expect(201);
    ids.admin = registered.body.user.id;
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [ids.admin]);
    await admin.post("/api/auth/login").send({ email, password }).expect(200);
    const adminCsrf = (await admin.get("/api/cart/csrf-token").expect(200)).body.csrf_token;
    const adminUrl = `/api/admin/orders/${ids.order}`;
    await admin.patch(`${adminUrl}/status`).set("X-CSRF-Token", adminCsrf)
      .send({ target_status: "confirmed" }).expect(409);

    const event = JSON.stringify({
      id: `evt_${randomUUID().replaceAll("-", "")}`, object: "event",
      type: "checkout.session.completed",
      data: { object: { ...session, status: "complete", payment_status: "paid", payment_intent: `pi_${randomUUID().replaceAll("-", "")}` } },
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload: event, secret });
    await request(app).post("/api/payments/webhook").set("Content-Type", "application/json")
      .set("Stripe-Signature", "invalid").send(event).expect(400);
    assert.equal((await guest.get(statusUrl).expect(200)).body.order.payment_status, "pending");
    for (let i = 0; i < 2; i++) {
      await request(app).post("/api/payments/webhook").set("Content-Type", "application/json")
        .set("Stripe-Signature", signature).send(event).expect(200);
    }

    assert.equal((await guest.get(statusUrl).expect(200)).body.order.payment_status, "paid");
    const detail = await admin.get(adminUrl).expect(200);
    assert.equal(detail.body.order.payment_status, "paid");
    assert.equal(detail.body.items.length, 1);
    assert.equal(detail.body.items[0].quantity, 3);
    for (const target_status of ["confirmed", "preparing", "ready", "completed"]) {
      const result = await admin.patch(`${adminUrl}/status`).set("X-CSRF-Token", adminCsrf)
        .send({ target_status }).expect(200);
      assert.equal(result.body.order.order_status, target_status);
      assert.equal(result.body.order.payment_status, "paid");
    }
    assert.equal((await guest.get(statusUrl).expect(200)).body.order.order_status, "completed");
    assert.equal(Number((await pool.query("SELECT stock FROM product_variants WHERE id = $1", [ids.variant])).rows[0].stock), 12);
    const payments = await pool.query("SELECT status FROM payments WHERE order_id = $1", [ids.order]);
    assert.equal(payments.rowCount, 1);
    assert.equal(payments.rows[0].status, "succeeded");
    const reservations = await pool.query("SELECT status FROM inventory_reservations WHERE order_id = $1", [ids.order]);
    assert.equal(reservations.rowCount, 1);
    assert.equal(reservations.rows[0].status, "committed");
    const notifications = await pool.query(
      "SELECT event_type, channel, status FROM order_notification_outbox WHERE order_id = $1 ORDER BY event_type",
      [ids.order],
    );
    assert.deepEqual(notifications.rows, ["order_completed", "order_confirmed", "order_paid", "order_ready"]
      .map((event_type) => ({ event_type, channel: "email", status: "pending" })));
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
    if (ids.admin) await admin.post("/api/auth/logout");
    if (ids.order) {
      for (const table of ["order_notification_outbox", "order_creation_requests", "checkout_attempts", "payments", "inventory_reservations", "order_items"]) {
        await pool.query(`DELETE FROM ${table} WHERE order_id = $1`, [ids.order]);
      }
      await pool.query("DELETE FROM orders WHERE id = $1", [ids.order]);
    }
    for (const cartId of [ids.cart, ids.strangerCart].filter(Boolean)) {
      await pool.query("DELETE FROM cart_items WHERE cart_id = $1", [cartId]);
      await pool.query("DELETE FROM cart WHERE id = $1", [cartId]);
    }
    if (ids.admin) await pool.query("UPDATE users SET deleted_at = NOW() WHERE id = $1", [ids.admin]);
    if (ids.variant) await pool.query("DELETE FROM product_variants WHERE id = $1", [ids.variant]);
    if (ids.product) await pool.query("DELETE FROM products WHERE id = $1", [ids.product]);
    if (ids.category) await pool.query("DELETE FROM categories WHERE id = $1", [ids.category]);
  }
});
