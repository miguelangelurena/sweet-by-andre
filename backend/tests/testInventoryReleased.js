
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "../src/config/database.js";

import {
    reserveInventoryForOrder,
    commitInventoryForOrder
} from "../src/services/inventoryReservation.service.js";

after(async () => {
    await pool.end();
});

test(
    "rejects released reservations without deducting inventory",
    { timeout: 15000 },
    async () => {
        // Safety check BEFORE writing any data.
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
            productIds: [],
            variantIds: [],
            cartId: null,
            orderId: null
        };

        try {
            // 1. Create temporary category.
            const categoryResult = await pool.query(
                `
                INSERT INTO categories (name)
                VALUES ($1)
                RETURNING id
                `,
                [`Released Test ${randomUUID()}`]
            );

            fixtures.categoryId = categoryResult.rows[0].id;

            // 2. Create two products and variants.
            const products = [
                {
                    name: "Butter Cookies Test",
                    stock: 15,
                    quantity: 3
                },
                {
                    name: "Chocolate Cookies Test",
                    stock: 10,
                    quantity: 4
                }
            ];

            const items = [];

            for (const productData of products) {
                const productResult = await pool.query(
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
                        productData.name,
                        "6.00",
                        productData.stock,
                        fixtures.categoryId
                    ]
                );

                const productId = productResult.rows[0].id;
                fixtures.productIds.push(productId);

                const variantResult = await pool.query(
                    `
                    INSERT INTO product_variants (
                        product_id,
                        price,
                        stock
                    )
                    VALUES ($1, $2, $3)
                    RETURNING id
                    `,
                    [
                        productId,
                        "6.00",
                        productData.stock
                    ]
                );

                const variantId = variantResult.rows[0].id;
                fixtures.variantIds.push(variantId);

                items.push({
                    productId,
                    variantId,
                    quantity: productData.quantity,
                    name: productData.name,
                    initialStock: productData.stock
                });
            }

            // 3. Create guest cart.
            const cartResult = await pool.query(
                `
                INSERT INTO cart (guest_token_hash)
                VALUES ($1)
                RETURNING id
                `,
                [randomBytes(32).toString("hex")]
            );

            fixtures.cartId = cartResult.rows[0].id;

            // 4. Create pending order.
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
                    fixtures.cartId,
                    "Released Test Customer",
                    "Test Street",
                    "123",
                    "Houston",
                    "TX",
                    "77001",
                    new Date(Date.now() + 5 * 86400000),
                    "42.00",
                    "0.00",
                    "0.00",
                    "42.00"
                ]
            );

            fixtures.orderId = orderResult.rows[0].id;

            // 5. Create order items.
            for (const item of items) {
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
                        item.productId,
                        item.variantId,
                        item.quantity,
                        "6.00",
                        item.name
                    ]
                );
            }

            // 6. Reserve both variants.
            const reserveClient = await pool.connect();

            try {
                await reserveClient.query("BEGIN");

                const reservations =
                    await reserveInventoryForOrder(
                        reserveClient,
                        fixtures.orderId,
                        new Date(Date.now() + 30 * 60000)
                    );

                assert.equal(reservations.length, 2);

                await reserveClient.query("COMMIT");
            } catch (error) {
                await reserveClient
                    .query("ROLLBACK")
                    .catch(() => {});

                throw error;
            } finally {
                reserveClient.release();
            }

            // 7. Simulate a safely released reservation.
            const releasedResult = await pool.query(
                `
                UPDATE inventory_reservations
                SET status = 'released',
                    updated_at = NOW()
                WHERE order_id = $1
                  AND variant_id = $2
                  AND status = 'reserved'
                RETURNING id
                `,
                [
                    fixtures.orderId,
                    items[0].variantId
                ]
            );

            assert.equal(
                releasedResult.rowCount,
                1,
                "Exactly one reservation must be released"
            );

            // 8. Attempt to commit the order.
            const commitClient = await pool.connect();

            try {
                await commitClient.query("BEGIN");

                await assert.rejects(
                    () => commitInventoryForOrder(
                        commitClient,
                        fixtures.orderId
                    ),
                    /inconsistent states/
                );
            } finally {
                // Always roll back the rejected attempt.
                await commitClient
                    .query("ROLLBACK")
                    .catch(() => {});

                commitClient.release();
            }

            // 9. Check that neither variant lost stock.
            const stockResult = await pool.query(
                `
                SELECT id, stock
                FROM product_variants
                WHERE id = ANY($1::uuid[])
                `,
                [fixtures.variantIds]
            );

            assert.equal(stockResult.rowCount, 2);

            const stockById = new Map(
                stockResult.rows.map(row => [
                    row.id,
                    Number(row.stock)
                ])
            );

            for (const item of items) {
                assert.equal(
                    stockById.get(item.variantId),
                    item.initialStock,
                    `Unexpected stock change: ${item.name}`
                );
            }

            // 10. Verify final reservation states.
            const reservationsResult = await pool.query(
                `
                SELECT variant_id, status
                FROM inventory_reservations
                WHERE order_id = $1
                `,
                [fixtures.orderId]
            );

            assert.equal(
                reservationsResult.rowCount,
                2
            );

            const statusByVariant = new Map(
                reservationsResult.rows.map(row => [
                    row.variant_id,
                    row.status
                ])
            );

            assert.equal(
                statusByVariant.get(items[0].variantId),
                "released"
            );

            assert.equal(
                statusByVariant.get(items[1].variantId),
                "reserved"
            );

            console.log(
                "Released reservation verified: no inventory deducted."
            );

        } finally {
            // 11. Clean up all temporary test records.
            if (fixtures.orderId) {
                await pool.query(
                    `
                    DELETE FROM inventory_reservations
                    WHERE order_id = $1
                    `,
                    [fixtures.orderId]
                );

                await pool.query(
                    `
                    DELETE FROM order_items
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

            for (const variantId of fixtures.variantIds) {
                await pool.query(
                    `
                    DELETE FROM product_variants
                    WHERE id = $1
                    `,
                    [variantId]
                );
            }

            for (const productId of fixtures.productIds) {
                await pool.query(
                    `
                    DELETE FROM products
                    WHERE id = $1
                    `,
                    [productId]
                );
            }

            if (fixtures.categoryId) {
                await pool.query(
                    `
                    DELETE FROM categories
                    WHERE id = $1
                    `,
                    [fixtures.categoryId]
                );
            }
        }
    }
);
