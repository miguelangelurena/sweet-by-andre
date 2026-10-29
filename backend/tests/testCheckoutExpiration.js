
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "../src/config/database.js";

import {
    prepareCheckoutAttempt,
    attachStripeSessionToAttempt
} from "../src/services/checkoutAttempt.service.js";

import {
    expireCheckoutSession
} from "../src/services/checkoutExpiration.service.js";

after(async () => {
    await pool.end();
});

test(
    "expires Checkout and releases inventory exactly once",
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
            const category = await pool.query(
                `INSERT INTO categories (name)
                 VALUES ($1) RETURNING id`,
                [`Expiration Test ${randomUUID()}`]
            );
            ids.category = category.rows[0].id;

            const product = await pool.query(
                `INSERT INTO products
                    (name, price, stock, category_id)
                 VALUES ($1, 6, 15, $2)
                 RETURNING id`,
                ["Expiration Test Cookies", ids.category]
            );
            ids.product = product.rows[0].id;

            const variant = await pool.query(
                `INSERT INTO product_variants
                    (product_id, price, stock)
                 VALUES ($1, 6, 15)
                 RETURNING id`,
                [ids.product]
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
                    guest_cart_id, shipping_name,
                    shipping_street, shipping_street_number,
                    shipping_city, shipping_state,
                    shipping_zip_code, delivery_date,
                    subtotal, shipping_cost, tax_amount,
                    total, payment_status, order_status
                )
                VALUES (
                    $1, 'Expiration Customer',
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
                    order_id, product_id, variant_id,
                    quantity, unit_price,
                    product_name_snapshot
                )
                VALUES ($1, $2, $3, 3, 6, $4)
                `,
                [
                    ids.order,
                    ids.product,
                    ids.variant,
                    "Expiration Test Cookies"
                ]
            );

            // Reserve 3 units from physical stock of 15.
            const prepared = await prepareCheckoutAttempt({
                orderId: ids.order,
                guestCartId: ids.cart
            });

            const sessionId =
                `cs_test_${randomBytes(16).toString("hex")}`;

            await attachStripeSessionToAttempt({
                attemptId: prepared.attempt.id,
                stripeSessionId: sessionId,
                expectedTotal: "18.00"
            });

            // Simulated authenticated Stripe session.
            const session = {
                id: sessionId,
                object: "checkout.session",
                mode: "payment",
                status: "expired",
                payment_status: "unpaid",
                metadata: {
                    order_id: ids.order,
                    checkout_attempt_id: prepared.attempt.id
                }
            };

            // First expiration.
            const first = await expireCheckoutSession(session);

            assert.equal(first.status, "expired");
            assert.equal(first.releasedCount, 1);

            // Duplicate expiration must be harmless.
            const second = await expireCheckoutSession(session);

            assert.equal(second.status, "already_expired");

            const reservations = await pool.query(
                `
                SELECT status, quantity
                FROM inventory_reservations
                WHERE order_id = $1
                `,
                [ids.order]
            );

            assert.equal(reservations.rowCount, 1);
            assert.equal(reservations.rows[0].status, "released");
            assert.equal(Number(reservations.rows[0].quantity), 3);

            const stock = await pool.query(
                `SELECT stock FROM product_variants WHERE id = $1`,
                [ids.variant]
            );

            assert.equal(Number(stock.rows[0].stock), 15);

            const attempt = await pool.query(
                `
                SELECT status FROM checkout_attempts
                WHERE id = $1
                `,
                [prepared.attempt.id]
            );

            assert.equal(attempt.rows[0].status, "expired");

            const payment = await pool.query(
                `
                SELECT status FROM payments
                WHERE order_id = $1
                `,
                [ids.order]
            );

            assert.equal(payment.rows[0].status, "failed");

            const savedOrder = await pool.query(
                `
                SELECT payment_status FROM orders
                WHERE id = $1
                `,
                [ids.order]
            );

            assert.equal(
                savedOrder.rows[0].payment_status,
                "pending"
            );

            console.log(
                "Checkout expiration verified: reservations released, " +
                "physical stock unchanged, duplicate event safe."
            );

        } finally {
            if (ids.order) {
                await pool.query(
                    "DELETE FROM checkout_attempts WHERE order_id = $1",
                    [ids.order]
                );

                await pool.query(
                    "DELETE FROM payments WHERE order_id = $1",
                    [ids.order]
                );

                await pool.query(
                    "DELETE FROM inventory_reservations WHERE order_id = $1",
                    [ids.order]
                );

                await pool.query(
                    "DELETE FROM order_items WHERE order_id = $1",
                    [ids.order]
                );

                await pool.query(
                    "DELETE FROM orders WHERE id = $1",
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
                    "DELETE FROM product_variants WHERE id = $1",
                    [ids.variant]
                );
            }

            if (ids.product) {
                await pool.query(
                    "DELETE FROM products WHERE id = $1",
                    [ids.product]
                );
            }

            if (ids.category) {
                await pool.query(
                    "DELETE FROM categories WHERE id = $1",
                    [ids.category]
                );
            }
        }
    }
);
