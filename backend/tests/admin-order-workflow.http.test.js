/**
 * Run only against sweet_by_andre_test:
 * node --env-file=.env.test --test tests/admin-order-workflow.http.test.js
 *
 * Creates a synthetic paid order in the isolated test DB to validate the
 * administration workflow. Does NOT interact with Stripe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";

import app from "../src/app.js";
import { pool } from "../src/config/database.js";

test("admin workflow requires session CSRF and paid orders, then progresses sequentially", async () => {
  const db = await pool.query("SELECT current_database() AS name");
  assert.equal(db.rows[0].name, "sweet_by_andre_test", "Refusing to run outside isolated test DB");

  const agent = request.agent(app);
  const email = `admin-workflow-${randomUUID()}@example.com`;
  const password = "NotARealPassword123!";
  let userId;
  let orderId;

  try {
    const registration = await agent.post("/api/auth/register").send({
      firstName: "Workflow", lastName: "Tester", email,
      phone: "5551234567", password,
    }).expect(201);
    userId = registration.body.user.id;
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [userId]);

    await agent.post("/api/auth/login").send({ email, password }).expect(200);
    const csrf = await agent.get("/api/cart/csrf-token").expect(200);
    const csrfToken = csrf.body.csrf_token;
    assert.match(csrfToken, /^[a-f0-9]{64}$/i);

    const created = await pool.query(`
      INSERT INTO orders (
        user_id, shipping_name, shipping_street,
        shipping_street_number, shipping_city, shipping_state,
        shipping_zip_code, delivery_date, subtotal, shipping_cost,
        tax_amount, total, payment_status, order_status
      ) VALUES (
        $1, 'Test Customer', 'Test Road', '12', 'Houston', 'TX',
        '77001', NOW() + INTERVAL '3 days', 6, 0, 0, 6, 'pending', 'pending'
      ) RETURNING id;
    `, [userId]);
    orderId = created.rows[0].id;
    const url = `/api/admin/orders/${orderId}/status`;

    await agent.patch(url).send({ target_status: "confirmed" }).expect(403);
    await agent.patch(url).set("X-CSRF-Token", "0".repeat(64))
      .send({ target_status: "confirmed" }).expect(403);
    await agent.patch(url).set("X-CSRF-Token", csrfToken)
      .send({ target_status: "cancelled" }).expect(400);
    await agent.patch(url).set("X-CSRF-Token", csrfToken)
      .send({ target_status: "confirmed" }).expect(409);

    // Only in the isolated test database: simulate the confirmed paid state.
    await pool.query("UPDATE orders SET payment_status = 'paid' WHERE id = $1", [orderId]);
    await agent.patch(url).set("X-CSRF-Token", csrfToken)
      .send({ target_status: "completed" }).expect(409);

    for (const target of ["confirmed", "preparing", "ready", "completed"]) {
      const result = await agent.patch(url).set("X-CSRF-Token", csrfToken)
        .send({ target_status: target }).expect(200);
      assert.equal(result.body.order.payment_status, "paid");
      assert.equal(result.body.order.order_status, target);
    }
    await agent.patch(url).set("X-CSRF-Token", csrfToken)
      .send({ target_status: "completed" }).expect(409);

    const saved = await pool.query(
      "SELECT payment_status, order_status FROM orders WHERE id = $1", [orderId],
    );
    assert.equal(saved.rows[0].payment_status, "paid");
    assert.equal(saved.rows[0].order_status, "completed");
  } finally {
    if (orderId) await pool.query("DELETE FROM orders WHERE id = $1", [orderId]);
    if (userId) await pool.query("UPDATE users SET deleted_at = NOW() WHERE id = $1", [userId]);
  }
});
