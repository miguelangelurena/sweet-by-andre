
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "../src/config/database.js";
import {
    startDatabaseCheckout,
    resumeDatabaseCheckout
} from "../src/services/checkoutDatabase.service.js";

after(async () => {
    await pool.end();
});

test(
    "integrates database checkout with mocked Stripe",
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

        const ids = {
            category: null,
            product: null,
            variant: null,
            cart: null,
            order: null
        };

        let stripeCalls = 0;
        let retrieveCallsMain = 0;
        let createdSession = null;

        const stripeClient = {
            checkout: {
                sessions: {
                    create: async (params, options) => {
                        stripeCalls++;

                        assert.match(
                            options.idempotencyKey,
                            /^sweetbyandre_checkout_/
                        );

                        createdSession = {
                            id: `cs_test_${randomBytes(16).toString("hex")}`,
                            object: "checkout.session",
                            mode: "payment",
                            status: "open",
                            payment_status: "unpaid",
                            currency: "usd",
                            amount_total:
                                params.line_items[0].price_data.unit_amount,
                            expires_at: params.expires_at,
                            metadata: params.metadata,
                            url:
                                "https://checkout.stripe.com/c/pay/mock"
                        };

                        return createdSession;
                    },
                    retrieve: async (sessionId) => {
                        retrieveCallsMain++;
                        assert.ok(createdSession);
                        assert.equal(sessionId, createdSession.id);
                        return { ...createdSession };
                    }
                }
            }
        };

        try {
            // Create temporary product fixtures.
            const category = await pool.query(
                `INSERT INTO categories (name)
                 VALUES ($1) RETURNING id`,
                [`Integration Test ${randomUUID()}`]
            );
            ids.category = category.rows[0].id;

            const product = await pool.query(
                `INSERT INTO products
                    (name, price, stock, category_id)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                ["Test Cookies", "6.00", 15, ids.category]
            );
            ids.product = product.rows[0].id;

            const variant = await pool.query(
                `INSERT INTO product_variants
                    (product_id, price, stock)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [ids.product, "6.00", 15]
            );
            ids.variant = variant.rows[0].id;

            const cart = await pool.query(
                `INSERT INTO cart (guest_token_hash)
                 VALUES ($1) RETURNING id`,
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
                    $1, $2, $3, $4, $5, $6, $7,
                    $8, $9, $10, $11, $12,
                    'pending', 'pending'
                )
                RETURNING id
                `,
                [
                    ids.cart,
                    "Integration Customer",
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
                VALUES ($1, $2, $3, $4, $5, $6)
                `,
                [
                    ids.order,
                    ids.product,
                    ids.variant,
                    3,
                    "6.00",
                    "Test Cookies"
                ]
            );

            const input = {
                orderId: ids.order,
                guestCartId: ids.cart,
                frontendUrl: "http://localhost:5173"
            };

            // First Checkout request.
            const first = await startDatabaseCheckout(
                input,
                stripeClient
            );

            assert.equal(first.status, "ready");
            assert.ok(first.paymentId);
            assert.equal(stripeCalls, 1);

            // A second request retrieves the same session, but never creates a new one.
            const second = await startDatabaseCheckout(
                input,
                stripeClient
            );

            assert.equal(second.status, "ready");
            assert.equal(second.reused, true);
            assert.equal(second.attemptId, first.attemptId);
            assert.equal(second.checkoutUrl, first.checkoutUrl);
            assert.equal(retrieveCallsMain, 1);
            assert.equal(stripeCalls, 1);


            // ==========================================
            // TEST: RESUME AN EXISTING CHECKOUT
            // ==========================================

            const savedAttemptResult = await pool.query(
                `
                SELECT
                    id,
                    stripe_session_id,
                    expires_at
                FROM checkout_attempts
                WHERE id = $1
                `,
                [first.attemptId]
            );

            assert.equal(savedAttemptResult.rowCount, 1);

            const savedAttempt = savedAttemptResult.rows[0];

            let retrieveCalls = 0;

            const resumeStripeClient = {
                checkout: {
                    sessions: {
                        retrieve: async sessionId => {
                            retrieveCalls++;

                            assert.equal(
                                sessionId,
                                savedAttempt.stripe_session_id
                            );

                            return {
                                id: sessionId,
                                object: "checkout.session",
                                mode: "payment",
                                status: "open",
                                payment_status: "unpaid",
                                currency: "usd",
                                amount_total: 1800,
                                expires_at: Math.floor(
                                    new Date(
                                        savedAttempt.expires_at
                                    ).getTime() / 1000
                                ),
                                metadata: {
                                    order_id: ids.order,
                                    checkout_attempt_id:
                                        first.attemptId
                                },
                                url:
                                    "https://checkout.stripe.com/" +
                                    "c/pay/resume-mock"
                            };
                        }
                    }
                }
            };

            // TEST: Recover a valid existing session.
            const resumed = await resumeDatabaseCheckout({
                orderId: ids.order,
                attemptId: first.attemptId,
                stripeClient: resumeStripeClient
            });

            assert.equal(resumed.status, "ready");
            assert.equal(resumed.reused, true);
            assert.equal(resumed.attemptId, first.attemptId);

            assert.equal(
                resumed.checkoutUrl,
                "https://checkout.stripe.com/c/pay/resume-mock"
            );

            assert.equal(retrieveCalls, 1);

            // Resuming must not create another session.
            assert.equal(stripeCalls, 1);

            // ==========================================
            // TEST: REJECT INVALID REMOTE SESSION
            // ==========================================

            const invalidStripeClient = {
                checkout: {
                    sessions: {
                        retrieve: async sessionId => ({
                            id: sessionId,
                            object: "checkout.session",
                            mode: "payment",
                            status: "open",
                            payment_status: "unpaid",
                            currency: "usd",

                            // Deliberately incorrect amount.
                            amount_total: 1900,

                            expires_at: Math.floor(
                                new Date(
                                    savedAttempt.expires_at
                                ).getTime() / 1000
                            ),

                            metadata: {
                                order_id: ids.order,
                                checkout_attempt_id:
                                    first.attemptId
                            },

                            url:
                                "https://checkout.stripe.com/" +
                                "c/pay/invalid-mock"
                        })
                    }
                }
            };

            const invalidResume =
                await resumeDatabaseCheckout({
                    orderId: ids.order,
                    attemptId: first.attemptId,
                    stripeClient: invalidStripeClient
                });

            assert.equal(
                invalidResume.status,
                "reconciliation_required"
            );

            // No additional Stripe sessions were created.
            assert.equal(stripeCalls, 1);

            console.log(
                "Checkout resume verified: existing session " +
                "reused, invalid amount rejected."
            );


            // Verify the database state.
            const attempts = await pool.query(
                `SELECT id, status, payment_id
                 FROM checkout_attempts
                 WHERE order_id = $1`,
                [ids.order]
            );

            assert.equal(attempts.rowCount, 1);
            assert.equal(attempts.rows[0].status, "open");
            assert.equal(
                attempts.rows[0].payment_id,
                first.paymentId
            );

            const payments = await pool.query(
                `SELECT id, status, amount
                 FROM payments
                 WHERE order_id = $1`,
                [ids.order]
            );

            assert.equal(payments.rowCount, 1);
            assert.equal(payments.rows[0].status, "pending");
            assert.equal(Number(payments.rows[0].amount), 18);

            const reservations = await pool.query(
                `SELECT quantity, status
                 FROM inventory_reservations
                 WHERE order_id = $1`,
                [ids.order]
            );

            assert.equal(reservations.rowCount, 1);
            assert.equal(reservations.rows[0].status, "reserved");
            assert.equal(
                Number(reservations.rows[0].quantity),
                3
            );

            const stock = await pool.query(
                `SELECT stock FROM product_variants
                 WHERE id = $1`,
                [ids.variant]
            );

            assert.equal(Number(stock.rows[0].stock), 15);

            console.log(
                "Database integration verified: " +
                "one attempt, one payment, one reservation."
            );


            // ==========================================
            // TEST: ORDER CHANGES WHILE STRIPE RESPONDS
            // ==========================================

            let concurrentRetrieveCalls = 0;

            const concurrentStripeClient = {
                checkout: {
                    sessions: {
                        retrieve: async sessionId => {
                            concurrentRetrieveCalls++;

                            // Simulate a concurrent state change
                            // after our initial database read,
                            // while waiting for Stripe.
                            const updated = await pool.query(
                                `
                                UPDATE orders
                                SET order_status = 'cancelled'
                                WHERE id = $1
                                RETURNING order_status
                                `,
                                [ids.order]
                            );

                            assert.equal(updated.rowCount, 1);
                            assert.equal(
                                updated.rows[0].order_status,
                                "cancelled"
                            );

                            // Stripe still reports an open session.
                            return resumeStripeClient.checkout.sessions
                                .retrieve(sessionId);
                        }
                    }
                }
            };

            const concurrentResult =
                await resumeDatabaseCheckout({
                    orderId: ids.order,
                    attemptId: first.attemptId,
                    stripeClient: concurrentStripeClient
                });

            assert.equal(concurrentRetrieveCalls, 1);

            assert.equal(
                concurrentResult.status,
                "reconciliation_required"
            );

            // No additional Stripe sessions were created.
            assert.equal(stripeCalls, 1);

            console.log(
                "Concurrent state change verified: " +
                "cancelled order cannot resume Checkout."
            );


        } finally {
            // Cleanup test records in dependency order.
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
                    `DELETE FROM cart WHERE id = $1`,
                    [ids.cart]
                );
            }
            if (ids.variant) {
                await pool.query(
                    `DELETE FROM product_variants WHERE id = $1`,
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