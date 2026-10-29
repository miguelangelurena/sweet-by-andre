
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

import { pool } from "../src/config/database.js";

import {
    GUEST_CART_COOKIE,
    generateGuestToken,
    hashGuestToken
} from "../src/utils/guestCart.js";

import {
    requireGuestCart
} from "../src/middleware/requireCart.js";

import {
    getGuestCsrfToken
} from "../src/middleware/guestCsrf.js";

import {
    requireCheckoutIdentity
} from "../src/middleware/requireCheckoutIdentity.js";

import {
    requireCheckoutOrder
} from "../src/middleware/requireCheckoutOrder.js";

after(async () => {
    await pool.end();
});

// Express application exclusively for this test.
// No real payment controller and no Stripe calls.
const app = express();

app.use(express.json());
app.use(cookieParser());

app.get(
    "/test/csrf",
    requireGuestCart,
    getGuestCsrfToken
);

app.post(
    "/test/checkout",
    requireCheckoutIdentity,
    requireCheckoutOrder,
    (req, res) => {
        res.status(200).json({
            status: "GOOD",
            order_id: req.checkoutOrder.id
        });
    }
);

test(
    "protects guest checkout with cookies, CSRF and ownership",
    { timeout: 15000 },
    async () => {
        // Verify database before performing any writes.
        const dbResult = await pool.query(
            "SELECT current_database() AS name"
        );

        assert.equal(
            dbResult.rows[0].name,
            "sweet_by_andre_test",
            "Unsafe database: refusing to run"
        );

        const fixtures = {
            cartIds: [],
            orderId: null
        };

        try {
            // 1. Create two independent guest identities.
            const ownerToken = generateGuestToken();
            const strangerToken = generateGuestToken();

            for (const token of [
                ownerToken,
                strangerToken
            ]) {
                const cartResult = await pool.query(
                    `
                    INSERT INTO cart (
                        user_id,
                        guest_token_hash
                    )
                    VALUES (NULL, $1)
                    RETURNING id
                    `,
                    [hashGuestToken(token)]
                );

                fixtures.cartIds.push(
                    cartResult.rows[0].id
                );
            }

            const ownerCookie =
                `${GUEST_CART_COOKIE}=${ownerToken}`;

            const strangerCookie =
                `${GUEST_CART_COOKIE}=${strangerToken}`;

            // 2. Create a pending order belonging to owner.
            const orderResult = await pool.query(
                `
                INSERT INTO orders (
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
                    $8, $9, $10, $11, $12,
                    'pending', 'pending'
                )
                RETURNING id
                `,
                [
                    fixtures.cartIds[0],
                    `Checkout HTTP ${randomUUID()}`,
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

            fixtures.orderId = orderResult.rows[0].id;

            // 3. Obtain CSRF token through real middleware.
            const csrfResponse = await request(app)
                .get("/test/csrf")
                .set("Cookie", ownerCookie);

            assert.equal(csrfResponse.status, 200);

            const csrfToken =
                csrfResponse.body.csrf_token;

            assert.match(
                csrfToken,
                /^[a-f0-9]{64}$/i
            );

            // TEST 1: Valid owner and correct CSRF.
            const validResponse = await request(app)
                .post("/test/checkout")
                .set("Cookie", ownerCookie)
                .set("X-CSRF-Token", csrfToken)
                .send({
                    order_id: fixtures.orderId
                });

            assert.equal(validResponse.status, 200);

            assert.equal(
                validResponse.body.order_id,
                fixtures.orderId
            );

            // TEST 2: Invalid CSRF.
            const invalidCsrf = await request(app)
                .post("/test/checkout")
                .set("Cookie", ownerCookie)
                .set("X-CSRF-Token", "0".repeat(64))
                .send({
                    order_id: fixtures.orderId
                });

            assert.equal(invalidCsrf.status, 403);

            // TEST 3: Missing guest cookie.
            const missingCookie = await request(app)
                .post("/test/checkout")
                .set("X-CSRF-Token", csrfToken)
                .send({
                    order_id: fixtures.orderId
                });

            assert.equal(missingCookie.status, 401);

            // TEST 4: Another guest cannot access order.
            const strangerCsrf = await request(app)
                .get("/test/csrf")
                .set("Cookie", strangerCookie);

            assert.equal(strangerCsrf.status, 200);

            const strangerResponse = await request(app)
                .post("/test/checkout")
                .set("Cookie", strangerCookie)
                .set(
                    "X-CSRF-Token",
                    strangerCsrf.body.csrf_token
                )
                .send({
                    order_id: fixtures.orderId
                });

            assert.equal(strangerResponse.status, 404);

            // TEST 5: Invalid order ID.
            const invalidOrderId = await request(app)
                .post("/test/checkout")
                .set("Cookie", ownerCookie)
                .set("X-CSRF-Token", csrfToken)
                .send({
                    order_id: "invalid-id"
                });

            assert.equal(invalidOrderId.status, 400);

            console.log(
                "Guest Checkout HTTP security: 5 scenarios passed."
            );

        } finally {
            // Remove only temporary test data.
            if (fixtures.orderId) {
                await pool.query(
                    "DELETE FROM orders WHERE id = $1",
                    [fixtures.orderId]
                );
            }

            for (const cartId of fixtures.cartIds) {
                await pool.query(
                    "DELETE FROM cart WHERE id = $1",
                    [cartId]
                );
            }
        }
    }
);
