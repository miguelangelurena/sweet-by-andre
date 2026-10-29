import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import request from "supertest";

import { pool } from "../src/config/database.js";
import { createPaymentsRouter } from "../src/routes/payments.routes.js";
import { getSessionCsrfToken } from "../src/middleware/sessionCsrf.js";
import { getGuestCsrfToken } from "../src/middleware/guestCsrf.js";
import { requireGuestCart } from "../src/middleware/requireCart.js";
import {
    GUEST_CART_COOKIE,
    generateGuestToken,
    hashGuestToken
} from "../src/utils/guestCart.js";

after(async () => {
    await pool.end();
});

test("real Checkout router enforces owner identity and CSRF", { timeout: 20000 }, async () => {
    // Never create fixtures outside the isolated test database.
    const database = await pool.query("SELECT current_database() AS name");
    assert.equal(database.rows[0].name, "sweet_by_andre_test");

    const fixtures = { users: [], carts: [], orders: [] };
    let checkoutCalls = 0;

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(session({
        secret: randomBytes(32).toString("hex"),
        resave: false,
        saveUninitialized: false,
        cookie: { httpOnly: true, sameSite: "lax" }
    }));

    // These two utility endpoints exist only in this isolated test app.
    app.post("/test/login", (req, res) => {
        req.session.userId = req.body.user_id;
        req.session.save(error => {
            if (error) return res.sendStatus(500);
            return res.status(200).json({ status: "GOOD" });
        });
    });
    app.get("/test/session-csrf", getSessionCsrfToken);
    app.get("/test/guest-csrf", requireGuestCart, getGuestCsrfToken);

    // Real production router and security middlewares, fake payment controller.
    app.use("/api", createPaymentsRouter({
        checkoutController: (req, res) => {
            checkoutCalls++;
            return res.status(200).json({
                status: "GOOD",
                order_id: req.checkoutOrder.id,
                user_id: req.user?.id ?? null,
                guest_cart_id: req.cartId ?? null
            });
        }
    }));

    async function createUser() {
        const result = await pool.query(`
            INSERT INTO users (first_name, last_name, email, phone, role)
            VALUES ($1, $2, $3, $4, 'customer')
            RETURNING id
        `, ["Router", "Test", `router-${randomUUID()}@example.com`, "5551234567"]);
        const id = result.rows[0].id;
        fixtures.users.push(id);
        return id;
    }

    async function createGuestCart(token) {
        const result = await pool.query(`
            INSERT INTO cart (user_id, guest_token_hash)
            VALUES (NULL, $1) RETURNING id
        `, [hashGuestToken(token)]);
        const id = result.rows[0].id;
        fixtures.carts.push(id);
        return id;
    }

    async function createOrder({ userId = null, cartId = null }) {
        const result = await pool.query(`
            INSERT INTO orders (
                user_id, guest_cart_id, shipping_name, shipping_street,
                shipping_street_number, shipping_city, shipping_state,
                shipping_zip_code, delivery_date, subtotal, shipping_cost,
                tax_amount, total, payment_status, order_status
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, 'pending', 'pending'
            ) RETURNING id
        `, [
            userId, cartId, "Router Test", "Test Street", "123",
            "Houston", "TX", "77001", new Date(Date.now() + 5 * 86400000),
            "18.00", "0.00", "0.00", "18.00"
        ]);
        const id = result.rows[0].id;
        fixtures.orders.push(id);
        return id;
    }

    try {
        const ownerId = await createUser();
        const strangerId = await createUser();
        const ownerOrder = await createOrder({ userId: ownerId });
        const ownerGuestToken = generateGuestToken();
        const strangerGuestToken = generateGuestToken();
        const ownerGuestCart = await createGuestCart(ownerGuestToken);
        await createGuestCart(strangerGuestToken);
        const guestOrder = await createOrder({ cartId: ownerGuestCart });

        const ownerAgent = request.agent(app);
        const strangerAgent = request.agent(app);
        assert.equal((await ownerAgent.post("/test/login").send({ user_id: ownerId })).status, 200);
        assert.equal((await strangerAgent.post("/test/login").send({ user_id: strangerId })).status, 200);
        const ownerCsrfResponse = await ownerAgent.get("/test/session-csrf");
        const strangerCsrfResponse = await strangerAgent.get("/test/session-csrf");
        assert.equal(ownerCsrfResponse.status, 200);
        assert.equal(strangerCsrfResponse.status, 200);
        const ownerCsrf = ownerCsrfResponse.body.csrf_token;
        const strangerCsrf = strangerCsrfResponse.body.csrf_token;
        assert.match(ownerCsrf, /^[a-f0-9]{64}$/i);

        const ownerCookie = `${GUEST_CART_COOKIE}=${ownerGuestToken}`;
        const strangerCookie = `${GUEST_CART_COOKIE}=${strangerGuestToken}`;
        const guestCsrfResponse = await request(app)
            .get("/test/guest-csrf").set("Cookie", ownerCookie);
        const strangerGuestCsrfResponse = await request(app)
            .get("/test/guest-csrf").set("Cookie", strangerCookie);
        assert.equal(guestCsrfResponse.status, 200);
        assert.equal(strangerGuestCsrfResponse.status, 200);
        const guestCsrf = guestCsrfResponse.body.csrf_token;

        const path = "/api/payments/checkout";
        async function expectRejected(promise, expectedStatus) {
            const callsBefore = checkoutCalls;
            const response = await promise;
            assert.equal(response.status, expectedStatus, JSON.stringify(response.body));
            assert.equal(checkoutCalls, callsBefore, "Rejected request reached Checkout");
        }

        // 1. Authenticated owner may access only their order.
        const authenticated = await ownerAgent.post(path)
            .set("X-CSRF-Token", ownerCsrf).send({ order_id: ownerOrder });
        assert.equal(authenticated.status, 200);
        assert.equal(authenticated.body.order_id, ownerOrder);
        assert.equal(authenticated.body.user_id, ownerId);
        assert.equal(checkoutCalls, 1);

        // 2. Guest owner may access only their order.
        const guest = await request(app).post(path)
            .set("Cookie", ownerCookie)
            .set("X-CSRF-Token", guestCsrf)
            .send({ order_id: guestOrder });
        assert.equal(guest.status, 200);
        assert.equal(guest.body.order_id, guestOrder);
        assert.equal(guest.body.guest_cart_id, ownerGuestCart);
        assert.equal(checkoutCalls, 2);

        // 3. Invalid session CSRF is blocked.
        await expectRejected(ownerAgent.post(path)
            .set("X-CSRF-Token", "0".repeat(64))
            .send({ order_id: ownerOrder }), 403);

        // 4. Invalid guest CSRF is blocked.
        await expectRejected(request(app).post(path)
            .set("Cookie", ownerCookie)
            .set("X-CSRF-Token", "0".repeat(64))
            .send({ order_id: guestOrder }), 403);

        // 5. Authenticated stranger cannot access another user's order.
        await expectRejected(strangerAgent.post(path)
            .set("X-CSRF-Token", strangerCsrf)
            .send({ order_id: ownerOrder }), 404);

        // 6. Guest stranger cannot access another guest's order.
        await expectRejected(request(app).post(path)
            .set("Cookie", strangerCookie)
            .set("X-CSRF-Token", strangerGuestCsrfResponse.body.csrf_token)
            .send({ order_id: guestOrder }), 404);

        // 7. Logged-in user cannot hijack guest order via guest cookie.
        await expectRejected(ownerAgent.post(path)
            .set("Cookie", ownerCookie)
            .set("X-CSRF-Token", ownerCsrf)
            .send({ order_id: guestOrder }), 404);

        // 8. Missing guest identity is blocked.
        await expectRejected(request(app).post(path)
            .send({ order_id: guestOrder }), 401);

        // 9. Invalid order UUID is blocked after valid guest CSRF.
        await expectRejected(request(app).post(path)
            .set("Cookie", ownerCookie)
            .set("X-CSRF-Token", guestCsrf)
            .send({ order_id: "invalid-id" }), 400);

        // 10. Deleted authenticated customers are blocked.
        await pool.query("UPDATE users SET deleted_at = NOW() WHERE id = $1", [ownerId]);
        await expectRejected(ownerAgent.post(path)
            .set("X-CSRF-Token", ownerCsrf)
            .send({ order_id: ownerOrder }), 401);

        assert.equal(checkoutCalls, 2, "Only the two valid requests may reach Checkout");
        console.log("Real Checkout router: 10 scenarios passed, 2 allowed, 8 rejected.");
    } finally {
        // Delete only fixtures created in this test.
        for (const id of fixtures.orders) {
            await pool.query("DELETE FROM orders WHERE id = $1", [id]);
        }
        for (const id of fixtures.carts) {
            await pool.query("DELETE FROM cart WHERE id = $1", [id]);
        }
        for (const id of fixtures.users) {
            await pool.query("DELETE FROM users WHERE id = $1", [id]);
        }
    }
});