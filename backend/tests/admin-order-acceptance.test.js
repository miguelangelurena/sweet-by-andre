
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";

import app from "../src/app.js";
import { pool } from "../src/config/database.js";

test("admin can accept a paid order only once", async () => {
    const agent = request.agent(app);

    const email = `admin-accept-${crypto.randomUUID()}@example.com`;
    const password = "TestPassword123!";

    let userId = null;
    let orderId = null;

    // Guard against accidentally using the development or production database.
    const dbName = await pool.query("SELECT current_database() AS name");
    assert.equal(dbName.rows[0].name, "sweet_by_andre_test");

    try {
        // 1. Create a temporary user.
        const registration = await agent
            .post("/api/auth/register")
            .send({
                firstName: "Test",
                lastName: "Admin",
                email,
                phone: "8095551234",
                password
            })
            .expect(201);

        userId = registration.body.user.id;

        // 2. Assign admin permissions for this test.
        await pool.query(
            "UPDATE users SET role = 'admin' WHERE id = $1",
            [userId]
        );

        // 3. Log in.
        await agent
            .post("/api/auth/login")
            .send({ email, password })
            .expect(200);

        // Retrieve session CSRF after login; protected writes require it.
        const csrfResponse = await agent.get("/api/cart/csrf-token").expect(200);
        const csrfToken = csrfResponse.body.csrf_token;
        assert.match(csrfToken, /^[0-9a-f]{64}$/i);

        // 4. Create a temporary unpaid order.
        const orderResult = await pool.query(
            `
            INSERT INTO orders (
                user_id,
                shipping_name,
                shipping_street,
                shipping_street_number,
                shipping_city,
                shipping_state,
                shipping_zip_code,
                delivery_date,
                subtotal,
                shipping_cost,
                tax_amount,
                total,
                payment_status,
                order_status
            )
            VALUES (
                $1, 'Test Customer', 'Test Street', '123',
                'Test City', 'TX', '75001',
                NOW() + INTERVAL '3 days',
                50, 0, 0, 50,
                'pending', 'pending'
            )
            RETURNING id;
            `,
            [userId]
        );

        orderId = orderResult.rows[0].id;

        // 5. An unpaid order must not be accepted.
        await agent
            .patch(`/api/admin/orders/${orderId}/accept`)
            .set("X-CSRF-Token", csrfToken)
            .expect(409);

        // 6. Simulate payment confirmation in the test database.
        await pool.query(
            "UPDATE orders SET payment_status = 'paid' WHERE id = $1",
            [orderId]
        );

        // 7. A paid order can be accepted.
        const accepted = await agent
            .patch(`/api/admin/orders/${orderId}/accept`)
            .set("X-CSRF-Token", csrfToken)
            .expect(200);

        assert.equal(accepted.body.status, "GOOD");
        assert.equal(accepted.body.order.payment_status, "paid");
        assert.equal(accepted.body.order.order_status, "confirmed");

        // 8. The same order cannot be accepted twice.
        await agent
            .patch(`/api/admin/orders/${orderId}/accept`)
            .set("X-CSRF-Token", csrfToken)
            .expect(409);

    } finally {
        // Remove only the temporary order created by this test.
        if (orderId) {
            await pool.query(
                "DELETE FROM orders WHERE id = $1",
                [orderId]
            );
        }

        // Deactivate the temporary user.
        if (userId) {
            await pool.query(
                `
                UPDATE users
                SET deleted_at = NOW()
                WHERE id = $1
                `,
                [userId]
            );
        }
    }
});
