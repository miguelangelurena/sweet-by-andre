
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "../src/config/database.js";

import {
    inspectCheckoutAttempt
} from "../src/services/checkoutAttempt.service.js";

after(async () => {
    await pool.end();
});

test(
    "classifies checkout attempts for safe recovery",
    { timeout: 15000 },
    async () => {
        // Never write to the development database.
        const database = await pool.query(
            "SELECT current_database() AS name"
        );

        assert.equal(
            database.rows[0].name,
            "sweet_by_andre_test",
            "Unsafe database: refusing to run"
        );

        const fixtures = {
            cartId: null,
            orderId: null
        };

        try {
            // Create a temporary guest cart.
            const cart = await pool.query(
                `
                INSERT INTO cart (guest_token_hash)
                VALUES ($1)
                RETURNING id
                `,
                [randomBytes(32).toString("hex")]
            );

            fixtures.cartId = cart.rows[0].id;

            // Create a temporary pending order.
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
                    `Recovery Test ${randomUUID()}`,
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

            // Helper to create a checkout attempt.
            async function createAttempt(status, expiresAt) {
                const result = await pool.query(
                    `
                    INSERT INTO checkout_attempts (
                        order_id,
                        status,
                        expires_at
                    )
                    VALUES ($1, $2, $3)
                    RETURNING id
                    `,
                    [
                        fixtures.orderId,
                        status,
                        expiresAt
                    ]
                );

                return result.rows[0].id;
            }

            // TEST 1: Creating attempt.
            const creatingId = await createAttempt(
                "creating",
                new Date(Date.now() + 3600000)
            );

            const creating = await inspectCheckoutAttempt(
                creatingId
            );

            assert.equal(
                creating.action,
                "reconcile_creation"
            );

            // Move the active attempt to a terminal state
            // before creating another one.
            await pool.query(
                `
                UPDATE checkout_attempts
                SET status = 'failed'
                WHERE id = $1
                `,
                [creatingId]
            );

            // TEST 2: Open attempt with linked payment.
            const payment = await pool.query(
                `
                INSERT INTO payments (
                    order_id,
                    stripe_payment_id,
                    amount,
                    status
                )
                VALUES ($1, $2, $3, 'pending')
                RETURNING id
                `,
                [
                    fixtures.orderId,
                    `cs_test_${randomBytes(16).toString("hex")}`,
                    "18.00"
                ]
            );

            const openId = await createAttempt(
                "open",
                new Date(Date.now() + 3600000)
            );

            await pool.query(
                `
                UPDATE checkout_attempts
                SET payment_id = $2,
                    stripe_session_id = $3
                WHERE id = $1
                `,
                [
                    openId,
                    payment.rows[0].id,
                    `cs_test_${randomBytes(16).toString("hex")}`
                ]
            );

            const open = await inspectCheckoutAttempt(openId);

            assert.equal(
                open.action,
                "verify_stripe_session"
            );

            // TEST 3: Completed attempt.
            await pool.query(
                `
                UPDATE checkout_attempts
                SET status = 'completed'
                WHERE id = $1
                `,
                [openId]
            );

            const completed = await inspectCheckoutAttempt(
                openId
            );

            assert.equal(
                completed.action,
                "already_completed"
            );

            // TEST 4: Failed attempt.
            const failed = await inspectCheckoutAttempt(
                creatingId
            );

            assert.equal(
                failed.action,
                "terminal_reconciliation"
            );

            // TEST 5: Locally expired creating attempt.
            const expiredCreatingId = await createAttempt(
                "creating",
                new Date(Date.now() - 3600000)
            );

            const expiredCreating =
                await inspectCheckoutAttempt(
                    expiredCreatingId
                );

            assert.equal(
                expiredCreating.action,
                "reconcile_expiration"
            );

            assert.equal(
                expiredCreating.expiredLocally,
                true
            );

            // TEST 6: Invalid UUID.
            await assert.rejects(
                () => inspectCheckoutAttempt("invalid-id"),
                error =>
                    error.status === 400
            );

            console.log(
                "Checkout recovery inspection: 6 scenarios passed."
            );

        } finally {
            if (fixtures.orderId) {
                await pool.query(
                    `
                    DELETE FROM checkout_attempts
                    WHERE order_id = $1
                    `,
                    [fixtures.orderId]
                );

                await pool.query(
                    `
                    DELETE FROM payments
                    WHERE order_id = $1
                    `,
                    [fixtures.orderId]
                );

                await pool.query(
                    `
                    DELETE FROM orders
                    WHERE id = $1
                    `,
                    [fixtures.orderId]
                );
            }

            if (fixtures.cartId) {
                await pool.query(
                    "DELETE FROM cart WHERE id = $1",
                    [fixtures.cartId]
                );
            }
        }
    }
);
