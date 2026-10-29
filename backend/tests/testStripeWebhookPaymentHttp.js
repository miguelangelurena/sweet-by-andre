
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";

import { pool } from "../src/config/database.js";
import { stripe } from "../src/config/stripe.js";

import {
    handleStripeWebhook
} from "../src/controllers/stripe-webhook.controllers.js";

import {
    prepareCheckoutAttempt,
    attachStripeSessionToAttempt
} from "../src/services/checkoutAttempt.service.js";

const TEST_SECRET = "whsec_sweet_by_andre_payment_http_test";

after(async () => {
    await pool.end();
});

function createTestApp() {
    const app = express();

    app.post(
        "/api/payments/webhook",
        express.raw({ type: "application/json" }),
        handleStripeWebhook
    );

    return app;
}

test(
    "confirms a signed Checkout payment exactly once",
    { timeout: 15000 },
    async () => {
        const db = await pool.query(
            "SELECT current_database() AS name"
        );

        assert.equal(
            db.rows[0].name,
            "sweet_by_andre_test",
            "Refusing to run outside test database"
        );

        const previousSecret =
            process.env.STRIPE_WEBHOOK_SECRET;

        process.env.STRIPE_WEBHOOK_SECRET = TEST_SECRET;

        const ids = {
            category: null,
            product: null,
            variant: null,
            cart: null,
            order: null
        };

        try {
            // 1. Create temporary inventory fixtures.
            const category = await pool.query(
                `
                INSERT INTO categories (name)
                VALUES ($1)
                RETURNING id
                `,
                [`Webhook HTTP ${randomUUID()}`]
            );

            ids.category = category.rows[0].id;

            const product = await pool.query(
                `
                INSERT INTO products (
                    name, price, stock, category_id
                )
                VALUES ($1, 6, 15, $2)
                RETURNING id
                `,
                ["Webhook Test Cookies", ids.category]
            );

            ids.product = product.rows[0].id;

            const variant = await pool.query(
                `
                INSERT INTO product_variants (
                    product_id, price, stock
                )
                VALUES ($1, 6, 15)
                RETURNING id
                `,
                [ids.product]
            );

            ids.variant = variant.rows[0].id;

            // 2. Create guest cart and pending order.
            const cart = await pool.query(
                `
                INSERT INTO cart (guest_token_hash)
                VALUES ($1)
                RETURNING id
                `,
                [randomBytes(32).toString("hex")]
            );

            ids.cart = cart.rows[0].id;

            const order = await pool.query(
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
                    $1, 'Webhook Test Customer',
                    'Test Street', '123',
                    'Houston', 'TX', '77001',
                    NOW() + INTERVAL '5 days',
                    18, 0, 0, 18,
                    'pending', 'pending'
                )
                RETURNING id
                `,
                [ids.cart]
            );

            ids.order = order.rows[0].id;

            await pool.query(
                `
                INSERT INTO order_items (
                    order_id,
                    product_id,
                    variant_id,
                    quantity,
                    unit_price,
                    product_name_snapshot
                )
                VALUES ($1, $2, $3, 3, 6, $4)
                `,
                [
                    ids.order,
                    ids.product,
                    ids.variant,
                    "Webhook Test Cookies"
                ]
            );

            // 3. Reserve inventory and create an attempt.
            const prepared = await prepareCheckoutAttempt({
                orderId: ids.order,
                guestCartId: ids.cart
            });

            assert.equal(prepared.reused, false);

            const attemptId = prepared.attempt.id;

            const sessionId =
                `cs_test_${randomBytes(16).toString("hex")}`;

            const paymentIntentId =
                `pi_${randomBytes(16).toString("hex")}`;

            await attachStripeSessionToAttempt({
                attemptId,
                stripeSessionId: sessionId,
                expectedTotal: "18.00"
            });

            // 4. Construct a simulated Stripe event.
            const event = {
                id: `evt_${randomBytes(12).toString("hex")}`,
                object: "event",
                type: "checkout.session.completed",
                data: {
                    object: {
                        id: sessionId,
                        object: "checkout.session",
                        mode: "payment",
                        status: "complete",
                        payment_status: "paid",
                        currency: "usd",
                        amount_total: 1800,
                        payment_intent: paymentIntentId,
                        metadata: {
                            order_id: ids.order,
                            checkout_attempt_id: attemptId
                        }
                    }
                }
            };

            const payload = JSON.stringify(event);

            const signature =
                stripe.webhooks.generateTestHeaderString({
                    payload,
                    secret: TEST_SECRET
                });

            const app = createTestApp();

            function sendWebhook() {
                return request(app)
                    .post("/api/payments/webhook")
                    .set("Content-Type", "application/json")
                    .set("Stripe-Signature", signature)
                    .send(payload);
            }

            // TEST 1: First delivery.
            const first = await sendWebhook();

            assert.equal(
                first.status,
                200,
                first.text
            );

            assert.deepEqual(first.body, {
                received: true
            });

            // TEST 2: Re-deliver the same signed event.
            const second = await sendWebhook();

            assert.equal(
                second.status,
                200,
                second.text
            );

            // TEST 3: Physical stock decreased once.
            const stock = await pool.query(
                `
                SELECT stock
                FROM product_variants
                WHERE id = $1
                `,
                [ids.variant]
            );

            assert.equal(
                Number(stock.rows[0].stock),
                12
            );

            // TEST 4: Reservation committed.
            const reservation = await pool.query(
                `
                SELECT quantity, status
                FROM inventory_reservations
                WHERE order_id = $1
                `,
                [ids.order]
            );

            assert.equal(reservation.rowCount, 1);
            assert.equal(
                reservation.rows[0].status,
                "committed"
            );
            assert.equal(
                Number(reservation.rows[0].quantity),
                3
            );

            // TEST 5: Payment succeeded.
            const payment = await pool.query(
                `
                SELECT
                    status,
                    stripe_payment_intent_id
                FROM payments
                WHERE order_id = $1
                `,
                [ids.order]
            );

            assert.equal(payment.rowCount, 1);
            assert.equal(
                payment.rows[0].status,
                "succeeded"
            );
            assert.equal(
                payment.rows[0].stripe_payment_intent_id,
                paymentIntentId
            );

            // TEST 6: Order paid.
            const savedOrder = await pool.query(
                `
                SELECT payment_status
                FROM orders
                WHERE id = $1
                `,
                [ids.order]
            );

            assert.equal(
                savedOrder.rows[0].payment_status,
                "paid"
            );

            // TEST 7: Checkout attempt completed.
            const attempt = await pool.query(
                `
                SELECT status
                FROM checkout_attempts
                WHERE id = $1
                `,
                [attemptId]
            );

            assert.equal(
                attempt.rows[0].status,
                "completed"
            );

            console.log(
                "Signed webhook verified: stock 15 -> 12, " +
                "payment succeeded, duplicate delivery safe."
            );

        } finally {
            // Restore environment configuration.
            if (previousSecret === undefined) {
                delete process.env.STRIPE_WEBHOOK_SECRET;
            } else {
                process.env.STRIPE_WEBHOOK_SECRET =
                    previousSecret;
            }

            // Clean up temporary test data.
            if (ids.order) {
                await pool.query(
                    `DELETE FROM checkout_attempts
                     WHERE order_id = $1`,
                    [ids.order]
                );

                await pool.query(
                    `DELETE FROM payments
                     WHERE order_id = $1`,
                    [ids.order]
                );

                await pool.query(
                    `DELETE FROM inventory_reservations
                     WHERE order_id = $1`,
                    [ids.order]
                );

                await pool.query(
                    `DELETE FROM order_items
                     WHERE order_id = $1`,
                    [ids.order]
                );

                await pool.query(
                    `DELETE FROM orders WHERE id = $1`,
                    [ids.order]
                );
            }

            if (ids.cart) {
                await pool.query(
                    "DELETE FROM cart WHERE id = $1",
                    [ids.cart]
                );
            }

            if (ids.variant) {
                await pool.query(
                    `DELETE FROM product_variants
                     WHERE id = $1`,
                    [ids.variant]
                );
            }

            if (ids.product) {
                await pool.query(
                    `DELETE FROM products WHERE id = $1`,
                    [ids.product]
                );
            }

            if (ids.category) {
                await pool.query(
                    `DELETE FROM categories WHERE id = $1`,
                    [ids.category]
                );
            }
        }
    }
);
