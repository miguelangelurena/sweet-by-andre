import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/database.js";

import {
    reserveInventoryForOrder
} from "../src/services/inventoryReservation.service.js";

const ORDER_ID = "8f0fa4dc-ca68-4b65-bfcf-dee2dd6a5352";

test("reserves inventory atomically without committing", async () => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const expiresAt = new Date(
            Date.now() + 30 * 60 * 1000
        );

        const reservations = await reserveInventoryForOrder(
            client,
            ORDER_ID,
            expiresAt
        );

        // The order contains two cart lines:
        // 2 Butter Cookies + 1 Butter Cookie.
        assert.equal(reservations.length, 1);
        assert.equal(Number(reservations[0].quantity), 3);
        assert.equal(reservations[0].status, "reserved");

        const result = await client.query(
            `
            SELECT quantity, status
            FROM inventory_reservations
            WHERE order_id = $1
            `,
            [ORDER_ID]
        );

        assert.equal(result.rows.length, 1);
        assert.equal(Number(result.rows[0].quantity), 3);

    } finally {
        // Never commit test reservations.
        await client.query("ROLLBACK");
        client.release();
    }
});


test("rejects reservations when inventory is insufficient", async () => {
    const client = await pool.connect();

    const variantId =
        "5a85218e-5963-4210-a37e-18f15f875314";

    try {
        await client.query("BEGIN");

        // Temporarily reduce stock inside the transaction.
        await client.query(
            `
            UPDATE product_variants
            SET stock = 2
            WHERE id = $1
            `,
            [variantId]
        );

        // The order requires 3 units, but only 2 are available.
        await assert.rejects(
            () =>
                reserveInventoryForOrder(
                    client,
                    ORDER_ID,
                    new Date(Date.now() + 30 * 60 * 1000)
                ),
            (error) => {
                assert.match(
                    error.message,
                    /Insufficient stock/
                );
                return true;
            }
        );

        // The failed reservation must not create any rows.
        const result = await client.query(
            `
            SELECT COUNT(*)::int AS count
            FROM inventory_reservations
            WHERE order_id = $1
            `,
            [ORDER_ID]
        );

        assert.equal(result.rows[0].count, 0);

    } finally {
        // Restore the original stock automatically.
        await client.query("ROLLBACK");
        client.release();
    }
});


test("prevents duplicate reservations for the same order", async () => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const expiresAt = new Date(
            Date.now() + 30 * 60 * 1000
        );

        // First reservation should succeed.
        const firstReservation =
            await reserveInventoryForOrder(
                client,
                ORDER_ID,
                expiresAt
            );

        assert.equal(firstReservation.length, 1);
        assert.equal(
            Number(firstReservation[0].quantity),
            3
        );

        // Reserving the same order again must fail.
        await assert.rejects(
            () => reserveInventoryForOrder(
                client,
                ORDER_ID,
                expiresAt
            ),
            (error) => {
                assert.match(
                    error.message,
                    /already has reservation history/
                );
                return true;
            }
        );

        // Still only one reservation in this transaction.
        const result = await client.query(
            `
            SELECT COUNT(*)::int AS count
            FROM inventory_reservations
            WHERE order_id = $1
            `,
            [ORDER_ID]
        );

        assert.equal(result.rows[0].count, 1);

    } finally {
        // Nothing is permanently saved.
        await client.query("ROLLBACK");
        client.release();
    }
});

after(async () => {
    await pool.end();
});