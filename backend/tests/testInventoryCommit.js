
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "../src/config/database.js";

import {
    reserveInventoryForOrder,
    commitInventoryForOrder
} from "../src/services/inventoryReservation.service.js";

test(
    "concurrent inventory commits deduct stock only once",
    { timeout: 15000 },
    async () => {
        const fixtures = {
            categoryId: null,
            productId: null,
            variantId: null,
            cartId: null,
            orderId: null
        };

        const dbResult = await pool.query(
            "SELECT current_database() AS name"
        );

        assert.equal(
            dbResult.rows[0].name,
            "sweet_by_andre_test",
            "Unsafe database: refusing to run"
        );

        try {
            const category = await pool.query(
                `INSERT INTO categories (name)
                 VALUES ($1) RETURNING id`,
                [`Concurrent Commit ${randomUUID()}`]
            );

            fixtures.categoryId = category.rows[0].id;

            const product = await pool.query(
                `INSERT INTO products
                 (name, price, stock, category_id)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                ["Concurrency Cookies", "6.00", 15, fixtures.categoryId]
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

            const cart = await pool.query(
                `INSERT INTO cart (guest_token_hash)
                 VALUES ($1) RETURNING id`,
                [randomBytes(32).toString("hex")]
            );

            fixtures.cartId = cart.rows[0].id;

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
                    "Concurrency Customer",
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
                `INSERT INTO order_items (
                    order_id, product_id, variant_id,
                    quantity, unit_price, product_name_snapshot
                )
                VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    fixtures.orderId,
                    fixtures.productId,
                    fixtures.variantId,
                    3,
                    "6.00",
                    "Concurrency Cookies"
                ]
            );

            // Create the reservation first.
            const reserveClient = await pool.connect();

            try {
                await reserveClient.query("BEGIN");

                await reserveInventoryForOrder(
                    reserveClient,
                    fixtures.orderId,
                    new Date(Date.now() + 30 * 60000)
                );

                await reserveClient.query("COMMIT");
            } catch (error) {
                await reserveClient.query("ROLLBACK").catch(() => { });
                throw error;
            } finally {
                reserveClient.release();
            }

            // Each process uses a different database connection.
            async function attemptCommit() {
                const client = await pool.connect();

                try {
                    await client.query("BEGIN");

                    const result = await commitInventoryForOrder(
                        client,
                        fixtures.orderId
                    );

                    await client.query("COMMIT");

                    return result.status;
                } catch (error) {
                    await client.query("ROLLBACK").catch(() => { });
                    throw error;
                } finally {
                    client.release();
                }
            }

            // Start both confirmations simultaneously.
            const results = await Promise.all([
                attemptCommit(),
                attemptCommit()
            ]);

            assert.deepEqual(
                results.sort(),
                ["already_committed", "committed"].sort()
            );

            const stockResult = await pool.query(
                `SELECT stock FROM product_variants WHERE id = $1`,
                [fixtures.variantId]
            );

            assert.equal(Number(stockResult.rows[0].stock), 12);

            const reservationResult = await pool.query(
                `SELECT status
                 FROM inventory_reservations
                 WHERE order_id = $1`,
                [fixtures.orderId]
            );

            assert.equal(reservationResult.rowCount, 1);
            assert.equal(
                reservationResult.rows[0].status,
                "committed"
            );

            console.log(
                "Concurrent commits verified: stock 15 -> 12."
            );

        } finally {
            if (fixtures.orderId) {
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
