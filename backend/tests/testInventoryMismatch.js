
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
    "rejects inventory reservations with mismatched quantities",
    { timeout: 15000 },
    async () => {
        // 1. Verify database before modifying anything.
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
            // 2. Create temporary category.
            const categoryResult = await pool.query(
                `
                INSERT INTO categories (name)
                VALUES ($1)
                RETURNING id
                `,
                [`Mismatch Test ${randomUUID()}`]
            );

            fixtures.categoryId = categoryResult.rows[0].id;

            // 3. Create two test products and variants.
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

            // 4. Create isolated guest cart.
            const cartResult = await pool.query(
                `
                INSERT INTO cart (guest_token_hash)
                VALUES ($1)
                RETURNING id
                `,
                [randomBytes(32).toString("hex")]
            );

            fixtures.cartId = cartResult.rows[0].id;

            // 5. Create pending order.
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
                    "Mismatch Test Customer",
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

            // 6. Insert both order items.
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

            // 7. Reserve inventory correctly.
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
                    .catch(() => { });

                throw error;
            } finally {
                reserveClient.release();
            }

            // 8. Deliberately corrupt one reservation.
            // Order requires 3 Butter Cookies,
            // but reservation will contain only 2.
            const changedResult = await pool.query(
                `
                UPDATE inventory_reservations
                SET quantity = quantity - 1,
                    updated_at = NOW()
                WHERE order_id = $1
                  AND variant_id = $2
                  AND status = 'reserved'
                  AND quantity > 1
                RETURNING quantity
                `,
                [
                    fixtures.orderId,
                    items[0].variantId
                ]
            );

            assert.equal(
                changedResult.rowCount,
                1,
                "Exactly one reservation must change"
            );

            assert.equal(
                Number(changedResult.rows[0].quantity),
                2
            );

            // 9. Attempt confirmation.
            // The mismatched reservation must be rejected.
            const commitClient = await pool.connect();

            try {
                await commitClient.query("BEGIN");

                await assert.rejects(
                    () => commitInventoryForOrder(
                        commitClient,
                        fixtures.orderId
                    ),
                    /Inventory reservations do not match order items/
                );
            } finally {
                await commitClient
                    .query("ROLLBACK")
                    .catch(() => { });

                commitClient.release();
            }

            // 10. Verify physical stock remains unchanged.
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
                    `Unexpected inventory change for ${item.name}`
                );
            }

            // 11. Verify reservations were not committed.
            const reservationsResult = await pool.query(
                `
                SELECT variant_id, quantity, status
                FROM inventory_reservations
                WHERE order_id = $1
                `,
                [fixtures.orderId]
            );

            assert.equal(reservationsResult.rowCount, 2);

            const reservationsByVariant = new Map(
                reservationsResult.rows.map(row => [
                    row.variant_id,
                    row
                ])
            );

            assert.equal(
                Number(
                    reservationsByVariant.get(
                        items[0].variantId
                    ).quantity
                ),
                2
            );

            assert.equal(
                Number(
                    reservationsByVariant.get(
                        items[1].variantId
                    ).quantity
                ),
                4
            );

            assert.ok(
                reservationsResult.rows.every(
                    row => row.status === "reserved"
                ),
                "No reservation may be committed"
            );

            // 12. Ensure order remains unpaid.
            const finalOrderResult = await pool.query(
                `
                SELECT payment_status, order_status
                FROM orders
                WHERE id = $1
                `,
                [fixtures.orderId]
            );

            assert.equal(
                finalOrderResult.rows[0].payment_status,
                "pending"
            );

            assert.equal(
                finalOrderResult.rows[0].order_status,
                "pending"
            );

            console.log(
                "Reservation mismatch rejected: no inventory deducted."
            );

        } finally {
            // 13. Clean up temporary test data.
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
