
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
    "rolls back every inventory change when one variant fails",
    { timeout: 15000 },
    async () => {
        const fixtures = {
            categoryId: null,
            productIds: [],
            variantIds: [],
            cartId: null,
            orderId: null
        };

        // Verify the database before any writes.
        const dbResult = await pool.query(
            "SELECT current_database() AS name"
        );

        assert.equal(
            dbResult.rows[0].name,
            "sweet_by_andre_test",
            "Unsafe database: refusing to run"
        );

        try {
            // 1. Create a temporary category.
            const category = await pool.query(
                `
                INSERT INTO categories (name)
                VALUES ($1)
                RETURNING id
                `,
                [`Rollback Test ${randomUUID()}`]
            );

            fixtures.categoryId = category.rows[0].id;

            // 2. Create two products and variants.
            const products = [
                { name: "Butter Cookies Test", stock: 15, quantity: 3 },
                { name: "Chocolate Cookies Test", stock: 10, quantity: 4 }
            ];

            const items = [];

            for (const productData of products) {
                const productResult = await pool.query(
                    `
                    INSERT INTO products (
                        name, price, stock, category_id
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
                        product_id, price, stock
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

            // 3. Create a guest cart.
            const cartResult = await pool.query(
                `
                INSERT INTO cart (guest_token_hash)
                VALUES ($1)
                RETURNING id
                `,
                [randomBytes(32).toString("hex")]
            );

            fixtures.cartId = cartResult.rows[0].id;

            // 4. Create a pending order.
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
                    "Rollback Test Customer",
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

            // 5. Add both variants to the order.
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

            // 6. Reserve inventory successfully.
            const reserveClient = await pool.connect();

            try {
                await reserveClient.query("BEGIN");

                const result = await reserveInventoryForOrder(
                    reserveClient,
                    fixtures.orderId,
                    new Date(Date.now() + 30 * 60000)
                );

                assert.equal(result.length, 2);

                await reserveClient.query("COMMIT");
            } catch (error) {
                await reserveClient.query("ROLLBACK").catch(() => { });
                throw error;
            } finally {
                reserveClient.release();
            }

            // 7. Reduce stock for the LAST variant in locking order.
            // This makes the first variant update succeed before
            // the second variant throws an error.
            const sortedItems = [...items].sort((a, b) =>
                a.variantId.localeCompare(b.variantId, "en")
            );

            const firstItem = sortedItems[0];
            const failingItem = sortedItems[1];

            const reducedStock = failingItem.quantity - 1;

            await pool.query(
                `
                UPDATE product_variants
                SET stock = $2
                WHERE id = $1
                `,
                [failingItem.variantId, reducedStock]
            );

            // 8. Attempt to commit. The transaction must fail.
            const commitClient = await pool.connect();

            try {
                await commitClient.query("BEGIN");

                await assert.rejects(
                    () => commitInventoryForOrder(
                        commitClient,
                        fixtures.orderId
                    ),
                    /Insufficient physical stock/
                );

                await commitClient.query("ROLLBACK");
            } catch (error) {
                await commitClient.query("ROLLBACK").catch(() => { });
                throw error;
            } finally {
                commitClient.release();
            }

            // 9. Verify that the first stock deduction was rolled back.
            const stockResult = await pool.query(
                `
                SELECT id, stock
                FROM product_variants
                WHERE id = ANY($1::uuid[])
                `,
                [fixtures.variantIds]
            );

            const stockById = new Map(
                stockResult.rows.map(row => [
                    row.id,
                    Number(row.stock)
                ])
            );

            assert.equal(
                stockById.get(firstItem.variantId),
                firstItem.initialStock,
                "First variant stock must be restored"
            );

            assert.equal(
                stockById.get(failingItem.variantId),
                reducedStock,
                "Failing variant must not be deducted again"
            );

            // 10. Verify both reservations remain reserved.
            const reservationsResult = await pool.query(
                `
                SELECT status
                FROM inventory_reservations
                WHERE order_id = $1
                `,
                [fixtures.orderId]
            );

            assert.equal(reservationsResult.rowCount, 2);

            assert.ok(
                reservationsResult.rows.every(
                    row => row.status === "reserved"
                ),
                "All reservations must remain reserved"
            );

            console.log(
                "Rollback verified: no partial inventory deductions."
            );

        } finally {
            // Remove test fixtures without touching other records.
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

            for (const variantId of fixtures.variantIds) {
                await pool.query(
                    "DELETE FROM product_variants WHERE id = $1",
                    [variantId]
                );
            }

            for (const productId of fixtures.productIds) {
                await pool.query(
                    "DELETE FROM products WHERE id = $1",
                    [productId]
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
