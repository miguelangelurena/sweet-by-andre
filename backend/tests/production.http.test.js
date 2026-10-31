import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import { stripe } from "../src/config/stripe.js";
import { houstonDate } from "../src/services/deliveryPolicy.service.js";
import { requireTestDatabase } from "./helpers/requireTestDatabase.js";
after(() => pool.end());

test(
  "made-to-order capacity preserves legacy stock, serializes weighted bookings and follows payment outcomes",
  { timeout: 30000 },
  async (t) => {
    await requireTestDatabase(pool);
    const original = (
      await pool.query("SELECT config FROM production_settings WHERE id=TRUE")
    ).rows[0].config;
    const oldSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_production_test";
    const ids = { products: [], variants: [], carts: [], orders: [] },
      admin = request.agent(app);
    let settings, csrf, session;
    const amounts = [];
    const day = (delta) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + delta);
      return houstonDate(d);
    };
    const date = day(6),
      otherDate = day(7),
      expiryDate = day(8);
    const payload = {
      fulfillment_method: "pickup",
      fulfillment_date: date,
      fulfillment_time: "12:00",
      shipping_name: "Preparation Tester",
      customer_email: "production@example.com",
      customer_phone: "5551234567",
      sms_opt_in: false,
    };
    t.mock.method(stripe.checkout.sessions, "create", async (params) => {
      amounts.push(params.line_items[0].price_data.unit_amount);
      session = {
        id: `cs_test_${randomUUID().replaceAll("-", "")}`,
        object: "checkout.session",
        mode: "payment",
        status: "open",
        payment_status: "unpaid",
        currency: "usd",
        amount_total: params.line_items[0].price_data.unit_amount,
        expires_at: params.expires_at,
        metadata: params.metadata,
        url: "https://checkout.stripe.com/c/pay/production-test",
      };
      return { ...session };
    });
    t.mock.method(stripe.checkout.sessions, "retrieve", async (id) => {
      assert.equal(id, session.id);
      return { ...session };
    });
    async function buyer(variant, quantity) {
      const agent = request.agent(app);
      const cart = (await agent.post("/api/guest/cart").expect(201)).body.cart;
      ids.carts.push(cart.id);
      const token = (await agent.get("/api/guest/cart/csrf-token").expect(200))
        .body.csrf_token;
      await agent
        .post("/api/guest/cart/items")
        .set("X-CSRF-Token", token)
        .send({ variant_id: variant, quantity })
        .expect(200);
      return { agent, token };
    }
    async function place(b, changes = {}, key = randomUUID()) {
      const result = await b.agent
        .post("/api/guest/orders")
        .set("X-CSRF-Token", b.token)
        .set("Idempotency-Key", key)
        .send({ ...payload, ...changes });
      if (result.status === 201 && !ids.orders.includes(result.body.order.id))
        ids.orders.push(result.body.order.id);
      return result;
    }
    const checkout = (b, id) =>
      b.agent
        .post("/api/guest/payments/checkout")
        .set("X-CSRF-Token", b.token)
        .send({ order_id: id });
    async function save(config) {
      const saved = await admin
        .put("/api/admin/production")
        .set("X-CSRF-Token", csrf)
        .send({ version: settings.version, config })
        .expect(200);
      settings = saved.body.settings;
    }
    async function productMode(product, variant, mode, points) {
      await admin
        .put(`/api/admin/production/products/${product}`)
        .set("X-CSRF-Token", csrf)
        .send({
          inventory_mode: mode,
          variants: [{ id: variant, production_points: points }],
        })
        .expect(200);
    }
    async function sendEvent(type, changes) {
      const body = JSON.stringify({
        id: `evt_${randomUUID().replaceAll("-", "")}`,
        object: "event",
        type,
        data: { object: { ...session, ...changes } },
      });
      const signature = stripe.webhooks.generateTestHeaderString({
        payload: body,
        secret: process.env.STRIPE_WEBHOOK_SECRET,
      });
      const send = () =>
        request(app)
          .post("/api/payments/webhook")
          .set("Content-Type", "application/json")
          .set("Stripe-Signature", signature)
          .send(body);
      return { send };
    }
    async function variant(product, points, stock) {
      const v = (
        await pool.query(
          "INSERT INTO product_variants (product_id,price,stock,production_points) VALUES ($1,6,$2,$3) RETURNING id",
          [product, stock, points],
        )
      ).rows[0].id;
      ids.variants.push(v);
      return v;
    }
    try {
      await request(app).get("/api/admin/production").expect(401);
      const email = `production-${randomUUID()}@example.com`,
        password = "LocalProductionPassword123!";
      ids.user = (
        await admin
          .post("/api/auth/register")
          .send({
            firstName: "Production",
            lastName: "Admin",
            email,
            phone: "5551234567",
            password,
          })
          .expect(201)
      ).body.user.id;
      await admin.post("/api/auth/login").send({ email, password }).expect(200);
      await admin.get("/api/admin/production").expect(403);
      await pool.query("UPDATE users SET role='admin' WHERE id=$1", [ids.user]);
      const data = (await admin.get("/api/admin/production").expect(200)).body;
      settings = {
        version: data.settings.version,
        config: data.settings.config,
      };
      csrf = (await admin.get("/api/cart/csrf-token").expect(200)).body
        .csrf_token;
      await admin.put("/api/admin/production").send(settings).expect(403);
      const stale = settings.version;
      await save({
        ...settings.config,
        daily_capacity: 6,
        weekly_capacity: Array.from({ length: 7 }, () => ({
          enabled: true,
          capacity: null,
        })),
        date_overrides: [],
      });
      await admin
        .put("/api/admin/production")
        .set("X-CSRF-Token", csrf)
        .send({ ...settings, version: stale })
        .expect(409);
      ids.category = (
        await pool.query(
          "INSERT INTO categories (name) VALUES ($1) RETURNING id",
          [`Production ${randomUUID()}`],
        )
      ).rows[0].id;
      async function madeProduct(name) {
        const p = (
          await admin
            .post("/api/products")
            .send({ name, price: 6, stock: 0, category_id: ids.category })
            .expect(201)
        ).body.product;
        ids.products.push(p.id);
        assert.equal(p.inventory_mode, "made_to_order");
        return p.id;
      }
      const productA = await madeProduct("Made to order A"),
        productB = await madeProduct("Made to order B");
      const ready = (
        await pool.query(
          "INSERT INTO products (name,price,stock,category_id,inventory_mode) VALUES ('Ready Product',6,5,$1,'stock') RETURNING id",
          [ids.category],
        )
      ).rows[0].id;
      ids.products.push(ready);
      const aVariant = await variant(productA, 2, 0),
        bVariant = await variant(productB, 4, 0),
        readyVariant = await variant(ready, 1, 5);
      await admin
        .put(`/api/admin/production/products/${productA}`)
        .send({ inventory_mode: "stock", variants: [] })
        .expect(403);
      await admin
        .put(`/api/admin/production/products/${productA}`)
        .set("X-CSRF-Token", csrf)
        .send({
          inventory_mode: "stock",
          variants: [{ id: bVariant, production_points: 3 }],
        })
        .expect(409);
      const catalog = (await request(app).get("/api/products").expect(200)).body
        .products;
      assert.equal(
        catalog.find((p) => p.id === productA).has_available_variants,
        true,
      );
      assert.equal(
        (await request(app).get(`/api/products/${productA}`).expect(200)).body
          .product.inventory_mode,
        "made_to_order",
      );
      assert.equal(
        (
          await request(app)
            .get(`/api/products/${productA}/variants`)
            .expect(200)
        ).body.variants.length,
        1,
      );
      const a = await buyer(aVariant, 2),
        b = await buyer(bVariant, 1);
      assert.equal(
        (await a.agent.get("/api/guest/cart").expect(200)).body.cart
          .has_unavailable_items,
        false,
      );
      // Different products and stock locks; only the production calendar lock can
      // prevent both 4-point orders from taking the same remaining 6-point day.
      const results = await Promise.all([place(a), place(b)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal(
        results.find((r) => r.status === 409).body.code,
        "PRODUCTION_FULL",
      );
      const winner = results.find((r) => r.status === 201).body.order;
      const loser = results[0].status === 409 ? a : b;
      const different = await place(loser, { fulfillment_date: otherDate });
      assert.equal(different.status, 201);
      const before = (
        await request(app).get("/api/production/options").expect(200)
      ).body.options;
      assert.equal(before.days.find((d) => d.date === date).used, 4);
      assert.equal(before.days.find((d) => d.date === otherDate).used, 4);
      await admin
        .patch(`/api/admin/orders/${winner.id}/cancel-unpaid`)
        .set("X-CSRF-Token", csrf)
        .send({})
        .expect(200);
      assert.equal(
        (
          await pool.query(
            "SELECT status FROM production_reservations WHERE order_id=$1",
            [winner.id],
          )
        ).rows[0].status,
        "released",
      );
      await a.agent
        .post("/api/guest/cart/items")
        .set("X-CSRF-Token", a.token)
        .send({ variant_id: readyVariant, quantity: 1 })
        .expect(200);
      const key = randomUUID(),
        mixed = await place(a, {}, key);
      assert.equal(mixed.status, 201);
      assert.equal(Number(mixed.body.order.total), 18);
      assert.equal(
        (await place(a, {}, key)).body.order.id,
        mixed.body.order.id,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT points FROM production_reservations WHERE order_id=$1",
            [mixed.body.order.id],
          )
        ).rows[0].points,
        4,
      );
      // Change both directions after order creation. Existing snapshots determine
      // stock deductions and preparation load, never current product settings.
      await productMode(productA, aVariant, "stock", 9);
      await productMode(ready, readyVariant, "made_to_order", 5);
      const closed = {
        date,
        closed: true,
        capacity: null,
        note: "Private day off",
      };
      await save({ ...settings.config, date_overrides: [closed] });
      const blocked = await checkout(a, mixed.body.order.id);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.code, "PRODUCTION_CLOSED");
      assert.equal(amounts.length, 0);
      assert.equal(
        (
          await pool.query(
            "SELECT COUNT(*)::int AS count FROM inventory_reservations WHERE order_id=$1",
            [mixed.body.order.id],
          )
        ).rows[0].count,
        0,
        "failed preparation reservation rolls inventory back",
      );
      assert.ok(
        !JSON.stringify(
          (await request(app).get("/api/production/options")).body,
        ).includes("Private day off"),
      );
      await save({ ...settings.config, date_overrides: [] });
      await checkout(a, mixed.body.order.id).expect(200);
      assert.deepEqual(amounts, [1800]);
      const reservations = (
        await pool.query(
          "SELECT inventory_mode FROM inventory_reservations WHERE order_id=$1 ORDER BY inventory_mode",
          [mixed.body.order.id],
        )
      ).rows;
      assert.deepEqual(reservations, [
        { inventory_mode: "made_to_order" },
        { inventory_mode: "stock" },
      ]);
      await save({ ...settings.config, date_overrides: [closed] });
      await checkout(a, mixed.body.order.id).expect(200);
      assert.equal(
        amounts.length,
        1,
        "active checkout remains idempotent after blocking the date",
      );
      const paid = await sendEvent("checkout.session.completed", {
        status: "complete",
        payment_status: "paid",
        payment_intent: `pi_${randomUUID().replaceAll("-", "")}`,
      });
      await paid.send().expect(200);
      await paid.send().expect(200);
      const stocks = (
        await pool.query(
          "SELECT id,stock FROM product_variants WHERE id=ANY($1::uuid[])",
          [[aVariant, readyVariant]],
        )
      ).rows;
      assert.equal(
        stocks.find((v) => v.id === aVariant).stock,
        0,
        "made-to-order stock never decremented",
      );
      assert.equal(
        stocks.find((v) => v.id === readyVariant).stock,
        4,
        "legacy stock snapshot still deducts exactly once",
      );
      const committed = (
        await pool.query(
          "SELECT points,status FROM production_reservations WHERE order_id=$1",
          [mixed.body.order.id],
        )
      ).rows[0];
      assert.deepEqual(committed, { points: 4, status: "committed" });
      await assert.rejects(
        pool.query(
          "UPDATE production_reservations SET points=99 WHERE order_id=$1",
          [mixed.body.order.id],
        ),
        /immutable/,
      );
      await pool.query(
        "UPDATE production_reservations SET expires_at=NOW()-INTERVAL '1 day' WHERE order_id=$1",
        [mixed.body.order.id],
      );
      await save({ ...settings.config, date_overrides: [] });
      assert.equal(
        (
          await request(app).get("/api/production/options")
        ).body.options.days.find((d) => d.date === date).used,
        4,
        "paid preparation remains booked after expiry",
      );
      const expiredOrder = await place(b, { fulfillment_date: expiryDate });
      assert.equal(expiredOrder.status, 201);
      await checkout(b, expiredOrder.body.order.id).expect(200);
      assert.deepEqual(amounts, [1800, 600]);
      await (
        await sendEvent("checkout.session.expired", {
          status: "expired",
          payment_status: "unpaid",
        })
      )
        .send()
        .expect(200);
      assert.equal(
        (
          await pool.query(
            "SELECT status FROM production_reservations WHERE order_id=$1",
            [expiredOrder.body.order.id],
          )
        ).rows[0].status,
        "released",
      );
      assert.equal(
        (
          await request(app).get("/api/production/options")
        ).body.options.days.find((d) => d.date === expiryDate).used,
        0,
      );
      const held = await place(b, { fulfillment_date: expiryDate });
      assert.equal(held.status, 201);
      await pool.query(
        "UPDATE production_reservations SET expires_at=NOW()-INTERVAL '1 minute' WHERE order_id=$1",
        [held.body.order.id],
      );
      const oldHold = await checkout(b, held.body.order.id);
      assert.equal(oldHold.status, 409);
      assert.equal(oldHold.body.code, "PRODUCTION_HOLD_EXPIRED");
      await productMode(productA, aVariant, "made_to_order", 3);
      assert.equal(
        (await place(a)).body.code,
        "PRODUCTION_FULL",
        "new variants use new loads; paid history stays unchanged",
      );
      const details = (
        await admin.get(`/api/admin/orders/${mixed.body.order.id}`).expect(200)
      ).body;
      assert.equal(details.order.preparation_points, 4);
      assert.equal(details.order.payment_status, "paid");
      console.log(
        "Production verified: weighted capacity by date, no stock required, mixed/legacy snapshots, payment idempotency and expiry/cancellation release.",
      );
    } finally {
      if (oldSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = oldSecret;
      await pool.query(
        "UPDATE production_settings SET config=$1,version=version+1 WHERE id=TRUE",
        [JSON.stringify(original)],
      );
      if (ids.user) await admin.post("/api/auth/logout");
      for (const order of ids.orders) {
        for (const table of [
          "order_notification_outbox",
          "order_creation_requests",
          "checkout_attempts",
          "payments",
          "inventory_reservations",
          "order_items",
        ])
          await pool.query(`DELETE FROM ${table} WHERE order_id=$1`, [order]);
        await pool.query("DELETE FROM orders WHERE id=$1", [order]);
      }
      for (const cart of ids.carts) {
        await pool.query("DELETE FROM cart_items WHERE cart_id=$1", [cart]);
        await pool.query("DELETE FROM cart WHERE id=$1", [cart]);
      }
      for (const variant of ids.variants)
        await pool.query("DELETE FROM product_variants WHERE id=$1", [variant]);
      for (const product of ids.products)
        await pool.query("DELETE FROM products WHERE id=$1", [product]);
      if (ids.category)
        await pool.query("DELETE FROM categories WHERE id=$1", [ids.category]);
      if (ids.user)
        await pool.query("UPDATE users SET deleted_at=NOW() WHERE id=$1", [
          ids.user,
        ]);
    }
  },
);
