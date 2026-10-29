
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import request from "supertest";

import { pool } from "../src/config/database.js";

import {
    getSessionCsrfToken
} from "../src/middleware/sessionCsrf.js";

import {
    requireCheckoutIdentity
} from "../src/middleware/requireCheckoutIdentity.js";

import {
    requireCheckoutOrder
} from "../src/middleware/requireCheckoutOrder.js";

import {
    GUEST_CART_COOKIE,
    generateGuestToken,
    hashGuestToken
} from "../src/utils/guestCart.js";

after(async () => {
    await pool.end();
});

// Test-only Express application.
// Never register these test endpoints in production.
const app = express();

app.use(express.json());
app.use(cookieParser());

app.use(session({
    secret: randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax"
    }
}));

// Simulate successful login exclusively inside the test.
app.post("/test/login", (req, res) => {
    req.session.userId = req.body.user_id;

    req.session.save((error) => {
        if (error) {
            return res.sendStatus(500);
        }

        return res.status(200).json({
            status: "GOOD"
        });
    });
});

// Reuse the real session CSRF handler.
app.get(
    "/test/csrf",
    getSessionCsrfToken
);

// Protected endpoint with a fake Checkout response.
app.post(
    "/test/checkout",
    requireCheckoutIdentity,
    requireCheckoutOrder,
    (req, res) => {
        return res.status(200).json({
            status: "GOOD",
            order_id: req.checkoutOrder.id
        });
    }
);

test(
    "protects authenticated checkout sessions and ownership",
    { timeout: 15000 },
    async () => {
        const dbResult = await pool.query(
            "SELECT current_database() AS name"
        );

        assert.equal(
            dbResult.rows[0].name,
            "sweet_by_andre_test",
            "Unsafe database: refusing to run"
        );

        const fixtures = {
            userIds: [],
            orderIds: [],
            cartId: null
        };

        try {
            // 1. Create two independent customers.
            for (let index = 0; index < 2; index++) {
                const userResult = await pool.query(
                    `
                    INSERT INTO users (
                        first_name,
                        last_name,
                        email,
                        phone,
                        role
                    )
                    VALUES ($1, $2, $3, $4, 'customer')
                    RETURNING id
                    `,
                    [
                        `CheckoutTest${index}`,
                        "Customer",
                        `checkout-${randomUUID()}@example.com`,
                        "5551234567"
                    ]
                );

                fixtures.userIds.push(
                    userResult.rows[0].id
                );
            }

            const ownerId = fixtures.userIds[0];
            const strangerId = fixtures.userIds[1];

            // 2. Helper to create temporary orders.
            async function createOrder(owner) {
                const result = await pool.query(
                    `
                    INSERT INTO orders (
                        user_id,
                        guest_cart_id,
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
                        $1, $2, $3, $4, $5, $6, $7,
                        $8, $9, $10, $11, $12, $13,
                        'pending', 'pending'
                    )
                    RETURNING id
                    `,
                    [
                        owner.userId ?? null,
                        owner.cartId ?? null,
                        "Checkout Test Customer",
                        "Test Street",
                        "123",
                        "Houston",
                        "TX",
                        "77001",
                        new Date(Date.now() + 5 * 86400000),
                        "18.00",
                        "0.00",
                        "0.00",
                        "18.00"
                    ]
                );

                fixtures.orderIds.push(result.rows[0].id);
                return result.rows[0].id;
            }

            const ownerOrderId = await createOrder({
                userId: ownerId
            });

            // 3. Prepare a separate guest cart and order.
            const guestToken = generateGuestToken();

            const cartResult = await pool.query(
                `
                INSERT INTO cart (
                    user_id,
                    guest_token_hash
                )
                VALUES (NULL, $1)
                RETURNING id
                `,
                [hashGuestToken(guestToken)]
            );

            fixtures.cartId = cartResult.rows[0].id;

            const guestOrderId = await createOrder({
                cartId: fixtures.cartId
            });

            // 4. Create independent HTTP agents.
            const ownerAgent = request.agent(app);
            const strangerAgent = request.agent(app);

            const ownerLogin = await ownerAgent
                .post("/test/login")
                .send({ user_id: ownerId });

            assert.equal(ownerLogin.status, 200);

            const strangerLogin = await strangerAgent
                .post("/test/login")
                .send({ user_id: strangerId });

            assert.equal(strangerLogin.status, 200);

            // 5. Obtain valid CSRF tokens.
            const ownerCsrfResponse = await ownerAgent
                .get("/test/csrf");

            assert.equal(ownerCsrfResponse.status, 200);

            const ownerCsrf =
                ownerCsrfResponse.body.csrf_token;

            assert.match(
                ownerCsrf,
                /^[a-f0-9]{64}$/i
            );

            const strangerCsrfResponse =
                await strangerAgent.get("/test/csrf");

            assert.equal(strangerCsrfResponse.status, 200);

            const strangerCsrf =
                strangerCsrfResponse.body.csrf_token;

            // TEST 1: Authenticated owner succeeds.
            const validResponse = await ownerAgent
                .post("/test/checkout")
                .set("X-CSRF-Token", ownerCsrf)
                .send({
                    order_id: ownerOrderId
                });

            assert.equal(validResponse.status, 200);
            assert.equal(
                validResponse.body.order_id,
                ownerOrderId
            );

            // TEST 2: Invalid session CSRF is rejected.
            const invalidCsrf = await ownerAgent
                .post("/test/checkout")
                .set("X-CSRF-Token", "0".repeat(64))
                .send({
                    order_id: ownerOrderId
                });

            assert.equal(invalidCsrf.status, 403);

            // TEST 3: Another authenticated customer
            // cannot access the owner's order.
            const strangerResponse = await strangerAgent
                .post("/test/checkout")
                .set("X-CSRF-Token", strangerCsrf)
                .send({
                    order_id: ownerOrderId
                });

            assert.equal(strangerResponse.status, 404);

            // TEST 4: An authenticated customer cannot
            // switch to guest identity using a guest cookie.
            const guestCookie =
                `${GUEST_CART_COOKIE}=${guestToken}`;

            const guestAccess = await ownerAgent
                .post("/test/checkout")
                .set("Cookie", guestCookie)
                .set("X-CSRF-Token", ownerCsrf)
                .send({
                    order_id: guestOrderId
                });

            assert.equal(guestAccess.status, 404);

            // TEST 5: Deleted users are rejected.
            await pool.query(
                `
                UPDATE users
                SET deleted_at = NOW()
                WHERE id = $1
                `,
                [ownerId]
            );

            const deletedUserResponse = await ownerAgent
                .post("/test/checkout")
                .set("X-CSRF-Token", ownerCsrf)
                .send({
                    order_id: ownerOrderId
                });

            assert.equal(
                deletedUserResponse.status,
                401
            );

            console.log(
                "Authenticated Checkout HTTP security: 5 scenarios passed."
            );

        } finally {
            // Clean up only our test fixtures.
            for (const orderId of fixtures.orderIds) {
                await pool.query(
                    "DELETE FROM orders WHERE id = $1",
                    [orderId]
                );
            }

            if (fixtures.cartId) {
                await pool.query(
                    "DELETE FROM cart WHERE id = $1",
                    [fixtures.cartId]
                );
            }

            for (const userId of fixtures.userIds) {
                await pool.query(
                    "DELETE FROM users WHERE id = $1",
                    [userId]
                );
            }
        }
    }
);
