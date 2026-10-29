
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "../src/config/database.js";

import {
    startDatabaseCheckout
} from "../src/services/checkoutDatabase.service.js";

after(async () => {
    await pool.end();
});

test(
    "rejects Checkout attachment if order total changes",
    { timeout: 15000 },
    async () => {
        // Never modify the development database.
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

        let sessionId = null;

        try {
            const category = await pool.query(
                `INSERT INTO categories (name)
                 VALUES ($1) RETURNING id`,
                [`Amount Integrity ${randomUUID()}`]
            );
            ids.category = category.rows[0].id;

            const product = await pool.query(
                `INSERT INTO products
                    (name, price, stock, category_id)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                ["Amount Test Cookies", "6.00", 15, ids.category]
            );
            ids.product = product.rows[0].id;

            const variant = await pool.query(
                `INSERT INTO product_variants
                    (product_id, price, stock)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [ids.product, "6.00", 15]
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
                    ids.cart,
                    "Amount Integrity Customer",
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
            ids.order = order.rows[0].id;

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
                    ids.order,
                    ids.product,
                    ids.variant,
                    3,
                    "6.00",
                    "Amount Test Cookies"
                ]
            );

            // Stripe is simulated.
            // It changes the order AFTER receiving
            // the Checkout request, but BEFORE returning.
            const stripeClient = {
                checkout: {
                    sessions: {
                        create: async (params) => {
                            sessionId =
                                `cs_test_${randomBytes(16).toString("hex")}`;

                            assert.equal(
                                params.line_items[0]
                                    .price_data.unit_amount,
                                1800
                            );

                            // Simulate an external operation
                            // changing the amount to $24.
                            await pool.query(
                                `
                                UPDATE orders
                                SET total = 24.00
                                WHERE id = $1
                                `,
                                [ids.order]
                            );

                            return {
                                id: sessionId,
                                object: "checkout.session",
                                mode: "payment",
                                status: "open",
                                payment_status: "unpaid",
                                currency: "usd",
                                amount_total: 1800,
                                expires_at: params.expires_at,
                                metadata: params.metadata,
                                url:
                                    "https://checkout.stripe.com/" +
                                    "c/pay/mock"
                            };
                        }
                    }
                }
            };

            // Checkout must fail at local association.
            await assert.rejects(
                () => startDatabaseCheckout(
                    {
                        orderId: ids.order,
                        guestCartId: ids.cart,
                        frontendUrl: "http://localhost:5173"
                    },
                    stripeClient
                ),
                /Order total changed during Checkout/
            );

            // Attempt exists but was not marked open.
            const attempts = await pool.query(
                `
                SELECT status, payment_id, stripe_session_id
                FROM checkout_attempts
                WHERE order_id = $1
                `,
                [ids.order]
            );

            assert.equal(attempts.rowCount, 1);
            assert.equal(attempts.rows[0].status, "creating");
            assert.equal(attempts.rows[0].payment_id, null);
            assert.equal(
                attempts.rows[0].stripe_session_id,
                null
            );

            // There must be no local payment record.
            const payments = await pool.query(
                `
                SELECT COUNT(*)::int AS count
                FROM payments
                WHERE order_id = $1
                `,
                [ids.order]
            );

            assert.equal(payments.rows[0].count, 0);

            // The inventory reservation remains intact.
            const reservations = await pool.query(
                `
                SELECT status, quantity
                FROM inventory_reservations
                WHERE order_id = $1
                `,
                [ids.order]
            );

            assert.equal(reservations.rowCount, 1);
            assert.equal(
                reservations.rows[0].status,
                "reserved"
            );
            assert.equal(
                Number(reservations.rows[0].quantity),
                3
            );

            const stock = await pool.query(
                `
                SELECT stock
                FROM product_variants
                WHERE id = $1
                `,
                [ids.variant]
            );

            assert.equal(Number(stock.rows[0].stock), 15);

            console.log(
                "Amount mismatch rejected; " +
                "no local payment or inventory deduction."
            );

        } finally {
            // Test cleanup only.
            if (ids.order) {
                await pool.query(
                    `DELETE FROM checkout_attempts
                     WHERE order_id = $1`,
                    [ids.order]
                );

                await pool.query(
                    `DELETE FROM payments
                     WHERE order_id = $1`,
                    [ids.order]
                );

                await pool.query(
                    `DELETE FROM inventory_reservations
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
    }
);
