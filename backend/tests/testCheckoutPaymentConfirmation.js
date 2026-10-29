
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "../src/config/database.js";

import {
    prepareCheckoutAttempt,
    attachStripeSessionToAttempt
} from "../src/services/checkoutAttempt.service.js";

import {
    confirmPaidCheckoutSession
} from "../src/services/checkoutPaymentConfirmation.service.js";

after(async () => {
    await pool.end();
});

test(
    "confirms payment and inventory exactly once",
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

        try {
            // 1. Create temporary product.
            const category = await pool.query(
                `INSERT INTO categories (name)
                 VALUES ($1) RETURNING id`,
                [`Payment Confirmation ${randomUUID()}`]
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
                ["Confirmation Test Cookies", ids.category]
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

            // 2. Create guest cart.
            const cart = await pool.query(
                `
                INSERT INTO cart (guest_token_hash)
                VALUES ($1)
                RETURNING id
                `,
                [randomBytes(32).toString("hex")]
            );

            ids.cart = cart.rows[0].id;

            // 3. Create pending order.
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
                    $1, 'Test Customer', 'Test Street',
                    '123', 'Houston', 'TX', '77001',
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
                    "Confirmation Test Cookies"
                ]
            );

            // 4. Prepare the checkout and reserve stock.
            const prepared = await prepareCheckoutAttempt({
                orderId: ids.order,
                guestCartId: ids.cart
            });

            assert.equal(prepared.reused, false);

            const attemptId = prepared.attempt.id;

            // Fake Stripe identifiers, no API requests.
            const sessionId =
                `cs_test_${randomBytes(16).toString("hex")}`;

            const paymentIntentId =
                `pi_${randomBytes(16).toString("hex")}`;

            // 5. Attach a simulated Stripe session.
            await attachStripeSessionToAttempt({
                attemptId,
                stripeSessionId: sessionId,
                expectedTotal: "18.00"
            });

            // 6. Build a simulated PAID session.
            // The production caller will need a
            // signature-verified webhook.
            const session = {
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
            };

            // TEST 1: Confirm payment and inventory.
            const first =
                await confirmPaidCheckoutSession(session);

            assert.equal(first.status, "completed");
            assert.equal(first.inventoryStatus, "committed");

            // TEST 2: Re-deliver the same webhook.
            const second =
                await confirmPaidCheckoutSession(session);

            assert.equal(
                second.status,
                "already_completed"
            );

            // TEST 3: Inventory must be deducted once.
            const stock = await pool.query(
                `
                SELECT stock
                FROM product_variants
                WHERE id = $1
                `,
                [ids.variant]
            );

            assert.equal(Number(stock.rows[0].stock), 12);

            const reservations = await pool.query(
                `
                SELECT quantity, status
                FROM inventory_reservations
                WHERE order_id = $1
                `,
                [ids.order]
            );

            assert.equal(reservations.rowCount, 1);
            assert.equal(
                reservations.rows[0].status,
                "committed"
            );
            assert.equal(
                Number(reservations.rows[0].quantity),
                3
            );

            // TEST 4: Payment must be succeeded.
            const payments = await pool.query(
                `
                SELECT
                    status,
                    amount,
                    stripe_payment_intent_id
                FROM payments
                WHERE order_id = $1
                `,
                [ids.order]
            );

            assert.equal(payments.rowCount, 1);
            assert.equal(payments.rows[0].status, "succeeded");
            assert.equal(Number(payments.rows[0].amount), 18);
            assert.equal(
                payments.rows[0].stripe_payment_intent_id,
                paymentIntentId
            );

            // TEST 5: Order must be paid.
            const savedOrder = await pool.query(
                `
                SELECT payment_status, order_status
                FROM orders
                WHERE id = $1
                `,
                [ids.order]
            );

            assert.equal(
                savedOrder.rows[0].payment_status,
                "paid"
            );

            // TEST 6: Checkout attempt completed.
            const attempts = await pool.query(
                `
                SELECT status, payment_id
                FROM checkout_attempts
                WHERE id = $1
                `,
                [attemptId]
            );

            assert.equal(attempts.rowCount, 1);
            assert.equal(
                attempts.rows[0].status,
                "completed"
            );

            console.log(
                "Payment confirmed exactly once: " +
                "stock 15 -> 12, payment succeeded, " +
                "order paid, attempt completed."
            );

        } finally {
            // Test cleanup. Never use this cleanup
            // against development or production orders.
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
