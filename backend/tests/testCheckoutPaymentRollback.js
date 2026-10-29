
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "../src/config/database.js";
import {
    prepareCheckoutAttempt,
    attachStripeSessionToAttempt
} from "../src/services/checkoutAttempt.service.js";
import {
    confirmPaidCheckoutSession
} from "../src/services/checkoutPaymentConfirmation.service.js";

after(async () => {
    await pool.end();
});

test("rolls back inventory when payment confirmation fails", {
    timeout: 15000
}, async () => {
    const database = await pool.query(
        "SELECT current_database() AS name"
    );

    assert.equal(
        database.rows[0].name,
        "sweet_by_andre_test",
        "Refusing to run outside test database"
    );

    const fixture = {
        category: null,
        product: null,
        variant: null,
        carts: [],
        orders: []
    };

    try {
        const category = await pool.query(
            `INSERT INTO categories (name)
             VALUES ($1) RETURNING id`,
            [`Rollback ${randomUUID()}`]
        );
        fixture.category = category.rows[0].id;

        const product = await pool.query(
            `INSERT INTO products
                (name, price, stock, category_id)
             VALUES ('Rollback Cookies', 6, 15, $1)
             RETURNING id`,
            [fixture.category]
        );
        fixture.product = product.rows[0].id;

        const variant = await pool.query(
            `INSERT INTO product_variants
                (product_id, price, stock)
             VALUES ($1, 6, 15)
             RETURNING id`,
            [fixture.product]
        );
        fixture.variant = variant.rows[0].id;

        // Create two isolated guest orders.
        for (let i = 0; i < 2; i++) {
            const cart = await pool.query(
                `INSERT INTO cart (guest_token_hash)
                 VALUES ($1) RETURNING id`,
                [randomBytes(32).toString("hex")]
            );

            fixture.carts.push(cart.rows[0].id);

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
                    $1, 'Rollback Customer', 'Test Street',
                    '123', 'Houston', 'TX', '77001',
                    NOW() + INTERVAL '5 days',
                    18, 0, 0, 18, 'pending', 'pending'
                )
                RETURNING id
                `,
                [cart.rows[0].id]
            );

            fixture.orders.push(order.rows[0].id);
        }

        const [otherOrderId, targetOrderId] = fixture.orders;
        const targetCartId = fixture.carts[1];

        await pool.query(
            `
            INSERT INTO order_items (
                order_id, product_id, variant_id,
                quantity, unit_price, product_name_snapshot
            )
            VALUES ($1, $2, $3, 3, 6, 'Rollback Cookies')
            `,
            [
                targetOrderId,
                fixture.product,
                fixture.variant
            ]
        );

        // This PaymentIntent belongs to a DIFFERENT payment.
        const duplicatePaymentIntentId =
            `pi_${randomBytes(16).toString("hex")}`;

        await pool.query(
            `
            INSERT INTO payments (
                order_id,
                stripe_payment_id,
                stripe_payment_intent_id,
                amount,
                status
            )
            VALUES ($1, $2, $3, 18, 'succeeded')
            `,
            [
                otherOrderId,
                `cs_test_${randomBytes(16).toString("hex")}`,
                duplicatePaymentIntentId
            ]
        );

        // Prepare the target order normally.
        const prepared = await prepareCheckoutAttempt({
            orderId: targetOrderId,
            guestCartId: targetCartId
        });

        const attemptId = prepared.attempt.id;

        const sessionId =
            `cs_test_${randomBytes(16).toString("hex")}`;

        await attachStripeSessionToAttempt({
            attemptId,
            stripeSessionId: sessionId,
            expectedTotal: "18.00"
        });

        // Simulate a verified Stripe session whose
        // PaymentIntent collides with another payment.
        const session = {
            id: sessionId,
            object: "checkout.session",
            mode: "payment",
            status: "complete",
            payment_status: "paid",
            currency: "usd",
            amount_total: 1800,
            payment_intent: duplicatePaymentIntentId,
            metadata: {
                order_id: targetOrderId,
                checkout_attempt_id: attemptId
            }
        };

        // Payment update should violate the unique index.
        await assert.rejects(
            () => confirmPaidCheckoutSession(session),
            error => error.code === "23505"
        );

        // All inventory operations must be rolled back.
        const stock = await pool.query(
            `SELECT stock FROM product_variants
             WHERE id = $1`,
            [fixture.variant]
        );

        assert.equal(Number(stock.rows[0].stock), 15);

        const reservations = await pool.query(
            `
            SELECT status, quantity
            FROM inventory_reservations
            WHERE order_id = $1
            `,
            [targetOrderId]
        );

        assert.equal(reservations.rowCount, 1);
        assert.equal(reservations.rows[0].status, "reserved");
        assert.equal(Number(reservations.rows[0].quantity), 3);

        const payment = await pool.query(
            `
            SELECT status, stripe_payment_intent_id
            FROM payments
            WHERE order_id = $1
            `,
            [targetOrderId]
        );

        assert.equal(payment.rowCount, 1);
        assert.equal(payment.rows[0].status, "pending");
        assert.equal(
            payment.rows[0].stripe_payment_intent_id,
            null
        );

        const order = await pool.query(
            `
            SELECT payment_status, order_status
            FROM orders WHERE id = $1
            `,
            [targetOrderId]
        );

        assert.equal(order.rows[0].payment_status, "pending");
        assert.equal(order.rows[0].order_status, "pending");

        const attempt = await pool.query(
            `
            SELECT status
            FROM checkout_attempts
            WHERE id = $1
            `,
            [attemptId]
        );

        assert.equal(attempt.rows[0].status, "open");

        console.log(
            "Rollback verified: stock 15, reservation reserved, " +
            "payment pending, order pending, attempt open."
        );

    } finally {
        for (const orderId of fixture.orders) {
            await pool.query(
                `DELETE FROM checkout_attempts WHERE order_id = $1`,
                [orderId]
            );
            await pool.query(
                `DELETE FROM payments WHERE order_id = $1`,
                [orderId]
            );
            await pool.query(
                `DELETE FROM inventory_reservations WHERE order_id = $1`,
                [orderId]
            );
            await pool.query(
                `DELETE FROM order_items WHERE order_id = $1`,
                [orderId]
            );
            await pool.query(
                `DELETE FROM orders WHERE id = $1`,
                [orderId]
            );
        }

        for (const cartId of fixture.carts) {
            await pool.query(
                "DELETE FROM cart WHERE id = $1",
                [cartId]
            );
        }

        if (fixture.variant) {
            await pool.query(
                "DELETE FROM product_variants WHERE id = $1",
                [fixture.variant]
            );
        }

        if (fixture.product) {
            await pool.query(
                "DELETE FROM products WHERE id = $1",
                [fixture.product]
            );
        }

        if (fixture.category) {
            await pool.query(
                "DELETE FROM categories WHERE id = $1",
                [fixture.category]
            );
        }
    }
});
