
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "../src/config/database.js";

import {
    prepareCheckoutAttempt
} from "../src/services/checkoutAttempt.service.js";

after(async () => {
    await pool.end();
});

test(
    "creates one checkout attempt and reuses it safely",
    { timeout: 15000 },
    async () => {
        // Safety: never modify the development database.
        const dbResult = await pool.query(
            "SELECT current_database() AS name"
        );

        assert.equal(
            dbResult.rows[0].name,
            "sweet_by_andre_test",
            "Unsafe database: refusing to run"
        );

        const fixtures = {
            categoryId: null,
            productId: null,
            variantId: null,
            cartIds: [],
            orderId: null
        };

        try {
            // 1. Create category.
            const category = await pool.query(
                `
                INSERT INTO categories (name)
                VALUES ($1)
                RETURNING id
                `,
                [`Checkout Attempt Test ${randomUUID()}`]
            );

            fixtures.categoryId = category.rows[0].id;

            // 2. Create product.
            const product = await pool.query(
                `
                INSERT INTO products (
                    name, price, stock, category_id
                )
                VALUES ($1, $2, $3, $4)
                RETURNING id
                `,
                [
                    "Checkout Test Cookies",
                    "6.00",
                    15,
                    fixtures.categoryId
                ]
            );

            fixtures.productId = product.rows[0].id;

            // 3. Create variant with 15 units.
            const variant = await pool.query(
                `
                INSERT INTO product_variants (
                    product_id, price, stock
                )
                VALUES ($1, $2, $3)
                RETURNING id
                `,
                [fixtures.productId, "6.00", 15]
            );

            fixtures.variantId = variant.rows[0].id;

            // 4. Create owner and stranger guest carts.
            for (let i = 0; i < 2; i++) {
                const cart = await pool.query(
                    `
                    INSERT INTO cart (guest_token_hash)
                    VALUES ($1)
                    RETURNING id
                    `,
                    [randomBytes(32).toString("hex")]
                );

                fixtures.cartIds.push(cart.rows[0].id);
            }

            const ownerCartId = fixtures.cartIds[0];
            const strangerCartId = fixtures.cartIds[1];

            // 5. Create pending guest order.
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
                    ownerCartId,
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

            fixtures.orderId = order.rows[0].id;

            // 6. Add 3 units to the order.
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
                    "Checkout Test Cookies"
                ]
            );

            const args = {
                orderId: fixtures.orderId,
                guestCartId: ownerCartId
            };

            // 7. Two requests arrive simultaneously.
            const [first, second] = await Promise.all([
                prepareCheckoutAttempt(args),
                prepareCheckoutAttempt(args)
            ]);

            assert.equal(
                [first.reused, second.reused]
                    .filter(value => value === false)
                    .length,
                1,
                "Exactly one request must create the attempt"
            );

            assert.equal(
                [first.reused, second.reused]
                    .filter(value => value === true)
                    .length,
                1,
                "Exactly one request must reuse the attempt"
            );

            assert.equal(
                first.attempt.id,
                second.attempt.id
            );

            assert.equal(
                first.attempt.idempotency_key,
                second.attempt.idempotency_key
            );

            assert.equal(first.attempt.status, "creating");

            // 8. A later retry must reuse the same attempt.
            const retry = await prepareCheckoutAttempt(args);

            assert.equal(retry.reused, true);
            assert.equal(retry.attempt.id, first.attempt.id);

            // 9. Stranger cannot prepare this order.
            await assert.rejects(
                () => prepareCheckoutAttempt({
                    orderId: fixtures.orderId,
                    guestCartId: strangerCartId
                }),
                error =>
                    error.status === 404 &&
                    error.message === "Order not found"
            );

            // 10. Verify only one persisted attempt.
            const attemptsResult = await pool.query(
                `
                SELECT
                    id,
                    status,
                    idempotency_key,
                    stripe_session_id,
                    payment_id,
                    expires_at
                FROM checkout_attempts
                WHERE order_id = $1
                `,
                [fixtures.orderId]
            );

            assert.equal(attemptsResult.rowCount, 1);
            assert.equal(
                attemptsResult.rows[0].status,
                "creating"
            );

            assert.equal(
                attemptsResult.rows[0].stripe_session_id,
                null
            );

            assert.equal(
                attemptsResult.rows[0].payment_id,
                null
            );

            assert.ok(
                new Date(attemptsResult.rows[0].expires_at)
                > new Date()
            );

            // 11. Verify exactly one inventory reservation.
            const reservationResult = await pool.query(
                `
                SELECT variant_id, quantity, status
                FROM inventory_reservations
                WHERE order_id = $1
                `,
                [fixtures.orderId]
            );

            assert.equal(reservationResult.rowCount, 1);
            assert.equal(
                reservationResult.rows[0].variant_id,
                fixtures.variantId
            );

            assert.equal(
                Number(reservationResult.rows[0].quantity),
                3
            );

            assert.equal(
                reservationResult.rows[0].status,
                "reserved"
            );

            // 12. Physical stock must remain unchanged.
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

            // 13. No payment should exist yet.
            const paymentResult = await pool.query(
                `
                SELECT COUNT(*)::int AS count
                FROM payments
                WHERE order_id = $1
                `,
                [fixtures.orderId]
            );

            assert.equal(paymentResult.rows[0].count, 0);

            console.log(
                "Checkout attempt verified: one attempt, " +
                "one reservation, stock unchanged."
            );

        } finally {
            // Cleanup in foreign-key dependency order.
            if (fixtures.orderId) {
                await pool.query(
                    "DELETE FROM checkout_attempts WHERE order_id = $1",
                    [fixtures.orderId]
                );

                await pool.query(
                    "DELETE FROM inventory_reservations WHERE order_id = $1",
                    [fixtures.orderId]
                );

                await pool.query(
                    "DELETE FROM order_items WHERE order_id = $1",
                    [fixtures.orderId]
                );

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

            if (fixtures.variantId) {
                await pool.query(
                    "DELETE FROM product_variants WHERE id = $1",
                    [fixtures.variantId]
                );
            }

            if (fixtures.productId) {
                await pool.query(
                    "DELETE FROM products WHERE id = $1",
                    [fixtures.productId]
                );
            }

            if (fixtures.categoryId) {
                await pool.query(
                    "DELETE FROM categories WHERE id = $1",
                    [fixtures.categoryId]
                );
            }
        }
    }
);
