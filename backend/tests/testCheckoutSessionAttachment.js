
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "../src/config/database.js";

import {
    prepareCheckoutAttempt,
    attachStripeSessionToAttempt
} from "../src/services/checkoutAttempt.service.js";

after(async () => {
    await pool.end();
});

test(
    "attaches a Stripe session exactly once",
    { timeout: 15000 },
    async () => {
        const db = await pool.query(
            "SELECT current_database() AS name"
        );

        assert.equal(
            db.rows[0].name,
            "sweet_by_andre_test",
            "Unsafe database: refusing to run"
        );

        const fixtures = {
            categoryId: null,
            productId: null,
            variantId: null,
            cartId: null,
            orderId: null
        };

        try {
            // 1. Create isolated inventory fixtures.
            const category = await pool.query(
                `INSERT INTO categories (name)
                 VALUES ($1) RETURNING id`,
                [`Session Attachment ${randomUUID()}`]
            );

            fixtures.categoryId = category.rows[0].id;

            const product = await pool.query(
                `INSERT INTO products
                 (name, price, stock, category_id)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                [
                    "Attachment Test Cookies",
                    "6.00",
                    15,
                    fixtures.categoryId
                ]
            );

            fixtures.productId = product.rows[0].id;

            const variant = await pool.query(
                `INSERT INTO product_variants
                 (product_id, price, stock)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [fixtures.productId, "6.00", 15]
            );

            fixtures.variantId = variant.rows[0].id;

            // 2. Create guest cart.
            const cart = await pool.query(
                `INSERT INTO cart (guest_token_hash)
                 VALUES ($1) RETURNING id`,
                [randomBytes(32).toString("hex")]
            );

            fixtures.cartId = cart.rows[0].id;

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
                    $1, $2, $3, $4, $5, $6, $7,
                    $8, $9, $10, $11, $12,
                    'pending', 'pending'
                )
                RETURNING id
                `,
                [
                    fixtures.cartId,
                    "Attachment Test Customer",
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

            fixtures.orderId = order.rows[0].id;

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
                    fixtures.orderId,
                    fixtures.productId,
                    fixtures.variantId,
                    3,
                    "6.00",
                    "Attachment Test Cookies"
                ]
            );

            // 4. Prepare reservation and checkout attempt.
            const prepared = await prepareCheckoutAttempt({
                orderId: fixtures.orderId,
                guestCartId: fixtures.cartId
            });

            assert.equal(prepared.reused, false);
            assert.equal(prepared.attempt.status, "creating");

            // Fake identifiers: no Stripe API requests.
            const sessionId =
                `cs_test_${randomBytes(16).toString("hex")}`;

            const conflictingSessionId =
                `cs_test_${randomBytes(16).toString("hex")}`;

            // TEST 1: First attachment.
            const first = await attachStripeSessionToAttempt({
                attemptId: prepared.attempt.id,
                stripeSessionId: sessionId
            });

            assert.equal(first.reused, false);
            assert.equal(first.stripeSessionId, sessionId);
            assert.ok(first.paymentId);

            // TEST 2: Same session must be reused.
            const second = await attachStripeSessionToAttempt({
                attemptId: prepared.attempt.id,
                stripeSessionId: sessionId
            });

            assert.equal(second.reused, true);
            assert.equal(second.paymentId, first.paymentId);

            // TEST 3: Different session must be rejected.
            await assert.rejects(
                () => attachStripeSessionToAttempt({
                    attemptId: prepared.attempt.id,
                    stripeSessionId: conflictingSessionId
                }),
                /conflicting session/
            );

            // 5. Verify persisted attempt.
            const attemptResult = await pool.query(
                `
                SELECT
                    status,
                    payment_id,
                    stripe_session_id
                FROM checkout_attempts
                WHERE id = $1
                `,
                [prepared.attempt.id]
            );

            assert.equal(attemptResult.rowCount, 1);

            assert.equal(
                attemptResult.rows[0].status,
                "open"
            );

            assert.equal(
                attemptResult.rows[0].payment_id,
                first.paymentId
            );

            assert.equal(
                attemptResult.rows[0].stripe_session_id,
                sessionId
            );

            // 6. Verify exactly one local payment.
            const paymentResult = await pool.query(
                `
                SELECT id, status, amount, stripe_payment_id
                FROM payments
                WHERE order_id = $1
                `,
                [fixtures.orderId]
            );

            assert.equal(paymentResult.rowCount, 1);

            const payment = paymentResult.rows[0];

            assert.equal(payment.id, first.paymentId);
            assert.equal(payment.status, "pending");
            assert.equal(Number(payment.amount), 18);
            assert.equal(payment.stripe_payment_id, sessionId);

            // 7. Verify reservation is still active.
            const reservationResult = await pool.query(
                `
                SELECT status, quantity
                FROM inventory_reservations
                WHERE order_id = $1
                `,
                [fixtures.orderId]
            );

            assert.equal(reservationResult.rowCount, 1);
            assert.equal(
                reservationResult.rows[0].status,
                "reserved"
            );
            assert.equal(
                Number(reservationResult.rows[0].quantity),
                3
            );

            // 8. Physical stock must not be deducted yet.
            const stockResult = await pool.query(
                `
                SELECT stock
                FROM product_variants
                WHERE id = $1
                `,
                [fixtures.variantId]
            );

            assert.equal(
                Number(stockResult.rows[0].stock),
                15
            );

            console.log(
                "Session attachment verified: " +
                "one attempt, one payment, no inventory deduction."
            );

        } finally {
            // Delete in foreign-key dependency order.
            if (fixtures.orderId) {
                await pool.query(
                    `DELETE FROM checkout_attempts
                     WHERE order_id = $1`,
                    [fixtures.orderId]
                );

                await pool.query(
                    `DELETE FROM payments
                     WHERE order_id = $1`,
                    [fixtures.orderId]
                );

                await pool.query(
                    `DELETE FROM inventory_reservations
                     WHERE order_id = $1`,
                    [fixtures.orderId]
                );

                await pool.query(
                    `DELETE FROM order_items
                     WHERE order_id = $1`,
                    [fixtures.orderId]
                );

                await pool.query(
                    `DELETE FROM orders
                     WHERE id = $1`,
                    [fixtures.orderId]
                );
            }

            if (fixtures.cartId) {
                await pool.query(
                    `DELETE FROM cart WHERE id = $1`,
                    [fixtures.cartId]
                );
            }

            if (fixtures.variantId) {
                await pool.query(
                    `DELETE FROM product_variants WHERE id = $1`,
                    [fixtures.variantId]
                );
            }

            if (fixtures.productId) {
                await pool.query(
                    `DELETE FROM products WHERE id = $1`,
                    [fixtures.productId]
                );
            }

            if (fixtures.categoryId) {
                await pool.query(
                    `DELETE FROM categories WHERE id = $1`,
                    [fixtures.categoryId]
                );
            }
        }
    }
);
