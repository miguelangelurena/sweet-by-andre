
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../src/config/database.js";

after(async () => {
    await pool.end();
});

test("protects order data after Checkout starts", async () => {
    const db = await pool.query(
        "SELECT current_database() AS name"
    );

    assert.equal(
        db.rows[0].name,
        "sweet_by_andre_test",
        "Refusing to run outside the test database"
    );

    const ids = {
        cart: null,
        order: null,
        category: null,
        product: null,
        variant: null
    };

    try {
        const cart = await pool.query(
            `INSERT INTO cart (guest_token_hash)
             VALUES ($1) RETURNING id`,
            [randomBytes(32).toString("hex")]
        );
        ids.cart = cart.rows[0].id;

        const order = await pool.query(
            `INSERT INTO orders (
                guest_cart_id, shipping_name,
                shipping_street, shipping_street_number,
                shipping_city, shipping_state,
                shipping_zip_code, delivery_date,
                subtotal, shipping_cost, tax_amount,
                total, payment_status, order_status
            )
            VALUES (
                $1, 'Test Customer', 'Test Street',
                '123', 'Houston', 'TX', '77001',
                NOW() + INTERVAL '5 days',
                18, 0, 0, 18, 'pending', 'pending'
            )
            RETURNING id`,
            [ids.cart]
        );
        ids.order = order.rows[0].id;

        const category = await pool.query(
            `INSERT INTO categories (name)
             VALUES ($1) RETURNING id`,
            [`Protection ${randomUUID()}`]
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
            `INSERT INTO order_items (
                order_id, product_id, variant_id,
                quantity, unit_price, product_name_snapshot
            )
            VALUES ($1, $2, $3, 3, 6, 'Test Cookies')
            RETURNING id`,
            [ids.order, ids.product, ids.variant]
        );

        const itemId = item.rows[0].id;

        // 1. Modifications are permitted before Checkout.
        await pool.query(
            `UPDATE order_items SET notes = 'Test note'
             WHERE id = $1`,
            [itemId]
        );

        // 2. Simulate Checkout starting.
        await pool.query(
            `INSERT INTO checkout_attempts
                (order_id, status, expires_at)
             VALUES ($1, 'creating', NOW() + INTERVAL '2 hours')`,
            [ids.order]
        );

        // 3. Reject changes to the order total.
        await assert.rejects(
            pool.query(
                `UPDATE orders SET total = 24 WHERE id = $1`,
                [ids.order]
            ),
            /Order cannot be modified after Checkout starts/
        );

        // 4. Reject changes to quantities.
        await assert.rejects(
            pool.query(
                `UPDATE order_items SET quantity = 4
                 WHERE id = $1`,
                [itemId]
            ),
            /Order items cannot be modified/
        );

        // 5. Reject removal of items.
        await assert.rejects(
            pool.query(
                `DELETE FROM order_items WHERE id = $1`,
                [itemId]
            ),
            /Order items cannot be modified/
        );

        // 6. Reject adding new items.
        await assert.rejects(
            pool.query(
                `INSERT INTO order_items (
                    order_id, product_id, variant_id,
                    quantity, unit_price, product_name_snapshot
                )
                VALUES ($1, $2, $3, 1, 6, 'Test Cookies')`,
                [ids.order, ids.product, ids.variant]
            ),
            /Order items cannot be modified/
        );

        // 7. Payment and order states remain updatable.
        await pool.query(
            `UPDATE orders
             SET payment_status = 'paid'
             WHERE id = $1`,
            [ids.order]
        );

        const verified = await pool.query(
            `SELECT o.total, o.payment_status,
                    i.quantity, i.notes
             FROM orders o
             JOIN order_items i ON i.order_id = o.id
             WHERE o.id = $1`,
            [ids.order]
        );

        assert.equal(Number(verified.rows[0].total), 18);
        assert.equal(verified.rows[0].payment_status, "paid");
        assert.equal(verified.rows[0].quantity, 3);
        assert.equal(verified.rows[0].notes, "Test note");

        console.log(
            "Order protection verified: data locked, " +
            "payment status updates allowed."
        );

    } finally {
        if (ids.order) {
            // Remove attempts first so item cleanup is allowed.
            await pool.query(
                `DELETE FROM checkout_attempts
                 WHERE order_id = $1`,
                [ids.order]
            );
            await pool.query(
                `DELETE FROM order_items WHERE order_id = $1`,
                [ids.order]
            );
            await pool.query(
                `DELETE FROM orders WHERE id = $1`,
                [ids.order]
            );
        }

        if (ids.cart) {
            await pool.query(
                `DELETE FROM cart WHERE id = $1`,
                [ids.cart]
            );
        }
        if (ids.variant) {
            await pool.query(
                `DELETE FROM product_variants WHERE id = $1`,
                [ids.variant]
            );
        }
        if (ids.product) {
            await pool.query(
                `DELETE FROM products WHERE id = $1`,
                [ids.product]
            );
        }
        if (ids.category) {
            await pool.query(
                `DELETE FROM categories WHERE id = $1`,
                [ids.category]
            );
        }
    }
});
