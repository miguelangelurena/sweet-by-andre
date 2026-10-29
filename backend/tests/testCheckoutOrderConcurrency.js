
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../src/config/database.js";

after(async () => {
    await pool.end();
});

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

test(
    "serializes order item changes with checkout creation",
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
            cart: null,
            order: null,
            category: null,
            product: null,
            variant: null,
            item: null
        };

        let clientA;
        let clientB;
        let transactionOpen = false;
        let updatePromise;

        try {
            // 1. Create isolated fixtures.
            const cart = await pool.query(
                `INSERT INTO cart (guest_token_hash)
                 VALUES ($1) RETURNING id`,
                [randomBytes(32).toString("hex")]
            );
            ids.cart = cart.rows[0].id;

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
                    $1, 'Concurrency Test', 'Test Street',
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

            const category = await pool.query(
                `INSERT INTO categories (name)
                 VALUES ($1) RETURNING id`,
                [`Concurrency ${randomUUID()}`]
            );
            ids.category = category.rows[0].id;

            const product = await pool.query(
                `INSERT INTO products
                    (name, price, stock, category_id)
                 VALUES ('Test Cookies', 6, 15, $1)
                 RETURNING id`,
                [ids.category]
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

            const item = await pool.query(
                `
                INSERT INTO order_items (
                    order_id,
                    product_id,
                    variant_id,
                    quantity,
                    unit_price,
                    product_name_snapshot
                )
                VALUES ($1, $2, $3, 3, 6, 'Test Cookies')
                RETURNING id
                `,
                [ids.order, ids.product, ids.variant]
            );
            ids.item = item.rows[0].id;

            // 2. Acquire two independent connections.
            clientA = await pool.connect();
            clientB = await pool.connect();

            // Prevent a hanging test if locking breaks.
            await clientB.query(
                "SET lock_timeout = '5s'"
            );

            // 3. Connection A starts checkout.
            await clientA.query("BEGIN");
            transactionOpen = true;

            await clientA.query(
                `
                SELECT id
                FROM orders
                WHERE id = $1
                FOR UPDATE
                `,
                [ids.order]
            );

            await clientA.query(
                `
                INSERT INTO checkout_attempts (
                    order_id, status, expires_at
                )
                VALUES (
                    $1, 'creating',
                    NOW() + INTERVAL '2 hours'
                )
                `,
                [ids.order]
            );

            // 4. Connection B tries to edit the item.
            // Capture errors immediately to avoid
            // unhandled promise rejections.
            updatePromise = clientB.query(
                `
                UPDATE order_items
                SET quantity = 4
                WHERE id = $1
                `,
                [ids.item]
            ).then(
                result => ({ succeeded: true, result }),
                error => ({ succeeded: false, error })
            );

            let settled = false;

            updatePromise.then(() => {
                settled = true;
            });

            await sleep(150);

            assert.equal(
                settled,
                false,
                "Item UPDATE should wait for Checkout's lock"
            );

            // 6. Checkout commits.
            await clientA.query("COMMIT");
            transactionOpen = false;

            // 7. Item UPDATE should now be rejected.
            const outcome = await updatePromise;

            assert.equal(outcome.succeeded, false);

            assert.match(
                outcome.error.message,
                /Order items cannot be modified after Checkout starts/
            );

            // 8. Confirm original quantity remains.
            const result = await pool.query(
                `
                SELECT quantity
                FROM order_items
                WHERE id = $1
                `,
                [ids.item]
            );

            assert.equal(
                Number(result.rows[0].quantity),
                3
            );

            console.log(
                "Concurrency verified: item modification " +
                "waited and was rejected after Checkout committed."
            );

        } finally {
            if (transactionOpen && clientA) {
                await clientA.query("ROLLBACK").catch(() => { });
            }

            if (updatePromise) {
                await updatePromise.catch(() => { });
            }

            if (clientA) clientA.release();
            if (clientB) clientB.release();

            // Remove attempts before deleting items.
            if (ids.order) {
                await pool.query(
                    `DELETE FROM checkout_attempts
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
