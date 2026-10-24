
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "../src/config/database.js";
import {
    reserveInventoryForOrder
} from "../src/services/inventoryReservation.service.js";

after(async () => {
    await pool.end();
});

test(
    "prevents concurrent reservations from exceeding stock",
    { timeout: 15000 },
    async () => {
        const fixtures = {
            categoryId: null,
            productId: null,
            variantId: null,
            cartId: null,
            orderIds: []
        };

        // Never modify the development database.
        const dbResult = await pool.query(
            "SELECT current_database() AS name"
        );

        assert.equal(
            dbResult.rows[0].name,
            "sweet_by_andre_test",
            "Unsafe database: refusing to run"
        );

        try {
            // 1. Create an isolated category.
            const category = await pool.query(
                `
                INSERT INTO categories (name)
                VALUES ($1)
                RETURNING id
                `,
                [`Concurrency Test ${randomUUID()}`]
            );

            fixtures.categoryId = category.rows[0].id;

            // 2. Create a test product.
            const product = await pool.query(
                `
                INSERT INTO products (
                    name,
                    price,
                    stock,
                    category_id
                )
                VALUES ($1, $2, $3, $4)
                RETURNING id
                `,
                [
                    "Test Butter Cookies",
                    "6.00",
                    15,
                    fixtures.categoryId
                ]
            );

            fixtures.productId = product.rows[0].id;

            // 3. Create a variant with exactly 15 units.
            const variant = await pool.query(
                `
                INSERT INTO product_variants (
                    product_id,
                    price,
                    stock
                )
                VALUES ($1, $2, $3)
                RETURNING id
                `,
                [fixtures.productId, "6.00", 15]
            );

            fixtures.variantId = variant.rows[0].id;

            // 4. Create an isolated guest cart.
            const cart = await pool.query(
                `
                INSERT INTO cart (guest_token_hash)
                VALUES ($1)
                RETURNING id
                `,
                [randomBytes(32).toString("hex")]
            );

            fixtures.cartId = cart.rows[0].id;

            // 5. Create two independent pending orders.
            for (let index = 0; index < 2; index++) {
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
                        `Test Customer ${index + 1}`,
                        "Test Street",
                        "123",
                        "Houston",
                        "TX",
                        "77001",
                        new Date(Date.now() + 5 * 86400000),
                        "60.00",
                        "0.00",
                        "0.00",
                        "60.00"
                    ]
                );

                const orderId = order.rows[0].id;
                fixtures.orderIds.push(orderId);

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
                        orderId,
                        fixtures.productId,
                        fixtures.variantId,
                        10,
                        "6.00",
                        "Test Butter Cookies"
                    ]
                );
            }

            // 6. Each task owns a separate transaction.
            async function attemptReservation(orderId) {
                const client = await pool.connect();

                try {
                    await client.query("BEGIN");

                    const result =
                        await reserveInventoryForOrder(
                            client,
                            orderId,
                            new Date(Date.now() + 30 * 60000)
                        );

                    await client.query("COMMIT");

                    return {
                        success: true,
                        orderId,
                        reservations: result
                    };
                } catch (error) {
                    await client.query("ROLLBACK").catch(() => { });

                    return {
                        success: false,
                        orderId,
                        error
                    };
                } finally {
                    client.release();
                }
            }

            // 7. Launch both transactions concurrently.
            const results = await Promise.all(
                fixtures.orderIds.map(attemptReservation)
            );

            const succeeded = results.filter(r => r.success);
            const failed = results.filter(r => !r.success);

            assert.equal(
                succeeded.length,
                1,
                "Exactly one reservation must succeed"
            );

            assert.equal(
                failed.length,
                1,
                "Exactly one reservation must fail"
            );

            assert.match(
                failed[0].error.message,
                /Insufficient stock/
            );

            // 8. Confirm the persisted reservation.
            const reservationResult = await pool.query(
                `
                SELECT
                    COUNT(*)::int AS reservation_count,
                    COALESCE(SUM(quantity), 0)::int AS reserved
                FROM inventory_reservations
                WHERE variant_id = $1
                  AND status = 'reserved'
                `,
                [fixtures.variantId]
            );

            assert.equal(
                reservationResult.rows[0].reservation_count,
                1
            );

            assert.equal(
                reservationResult.rows[0].reserved,
                10
            );

            console.log(
                "Concurrency verified: 10 reserved, 5 available."
            );

        } finally {
            // Remove all fixtures, even if an assertion fails.
            // This cleanup affects only our test database.
            for (const orderId of fixtures.orderIds) {
                await pool.query(
                    "DELETE FROM inventory_reservations WHERE order_id = $1",
                    [orderId]
                );

                await pool.query(
                    "DELETE FROM order_items WHERE order_id = $1",
                    [orderId]
                );

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
