
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "../src/config/database.js";
import {
    requireCheckoutOrder
} from "../src/middleware/requireCheckoutOrder.js";

after(async () => {
    await pool.end();
});

// Execute the middleware without opening an HTTP server.
async function authorize(request) {
    return new Promise((resolve, reject) => {
        let finished = false;

        const finish = (result) => {
            if (finished) return;
            finished = true;
            resolve(result);
        };

        const response = {
            statusCode: 200,

            status(code) {
                this.statusCode = code;
                return this;
            },

            json(body) {
                finish({
                    statusCode: this.statusCode,
                    body,
                    authorized: false
                });

                return this;
            }
        };

        const next = (error) => {
            if (error) {
                reject(error);
                return;
            }

            finish({
                statusCode: 200,
                authorized: true,
                order: request.checkoutOrder
            });
        };

        Promise.resolve(
            requireCheckoutOrder(request, response, next)
        ).catch(reject);
    });
}

test(
    "authorizes checkout orders by ownership",
    { timeout: 15000 },
    async () => {
        // Safety guard before creating any fixtures.
        const database = await pool.query(
            "SELECT current_database() AS name"
        );

        assert.equal(
            database.rows[0].name,
            "sweet_by_andre_test",
            "Unsafe database: refusing to run"
        );

        const fixtures = {
            cartIds: [],
            orderId: null
        };

        try {
            // Create two independent guest carts.
            for (let i = 0; i < 2; i++) {
                const cartResult = await pool.query(
                    `
                    INSERT INTO cart (guest_token_hash)
                    VALUES ($1)
                    RETURNING id
                    `,
                    [randomBytes(32).toString("hex")]
                );

                fixtures.cartIds.push(cartResult.rows[0].id);
            }

            const ownerCartId = fixtures.cartIds[0];
            const strangerCartId = fixtures.cartIds[1];

            // Create an order belonging only to guest A.
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
                    ownerCartId,
                    `Checkout Test ${randomUUID()}`,
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

            fixtures.orderId = orderResult.rows[0].id;

            // TEST 1: Owner is authorized.
            const ownerRequest = {
                body: { order_id: fixtures.orderId },
                user: null,
                cartId: ownerCartId
            };

            const owner = await authorize(ownerRequest);

            assert.equal(owner.statusCode, 200);
            assert.equal(owner.authorized, true);
            assert.equal(owner.order.id, fixtures.orderId);

            // TEST 2: Another guest cannot access the order.
            const stranger = await authorize({
                body: { order_id: fixtures.orderId },
                user: null,
                cartId: strangerCartId
            });

            assert.equal(stranger.statusCode, 404);
            assert.equal(stranger.authorized, false);

            // TEST 3: Missing identity is rejected.
            const anonymous = await authorize({
                body: { order_id: fixtures.orderId },
                user: null,
                cartId: null
            });

            assert.equal(anonymous.statusCode, 401);
            assert.equal(anonymous.authorized, false);

            // TEST 4: Invalid UUID is rejected.
            const invalidId = await authorize({
                body: { order_id: "invalid-order-id" },
                user: null,
                cartId: ownerCartId
            });

            assert.equal(invalidId.statusCode, 400);
            assert.equal(invalidId.authorized, false);

            console.log(
                "Checkout ownership verified: 4 scenarios passed."
            );

        } finally {
            // Remove only our temporary test data.
            if (fixtures.orderId) {
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
        }
    }
);
