
import { pool } from "../config/database.js";

export const getAdminOrders = async (req, res) => {
    try {
        const result = await pool.query(
            `
            SELECT
                o.id,
                o.user_id,
                o.total,
                o.payment_status,
                o.order_status,
                o.delivery_date
            FROM orders o
            ORDER BY o.created_at DESC;
            `
        );

        return res.status(200).json({
            status: "GOOD",
            orders: result.rows
        });
    } catch (error) {
        console.error("Get admin orders error:", error);

        return res.status(500).json({
            status: "ERROR",
            message: "Could not retrieve orders"
        });
    }
};


export const getAdminOrderById = async (req, res) => {
    const { id } = req.params;

    try {
        const orderResult = await pool.query(
            `
            SELECT *
            FROM orders
            WHERE id = $1;
            `,
            [id]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Order not found"
            });
        }

        const itemsResult = await pool.query(
            `
            SELECT *
            FROM order_items
            WHERE order_id = $1;
            `,
            [id]
        );

        return res.status(200).json({
            status: "GOOD",
            order: orderResult.rows[0],
            items: itemsResult.rows
        });
    } catch (error) {
        console.error("Get admin order details error:", error);

        return res.status(500).json({
            status: "ERROR",
            message: "Could not retrieve order details"
        });
    }
};


export const acceptAdminOrder = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `
            UPDATE orders
            SET order_status = 'confirmed'
            WHERE id = $1
              AND payment_status = 'paid'
              AND order_status = 'pending'
            RETURNING id, payment_status, order_status;
            `,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(409).json({
                status: "ERROR",
                message: "Order cannot be accepted"
            });
        }

        return res.status(200).json({
            status: "GOOD",
            message: "Order accepted successfully",
            order: result.rows[0]
        });
    } catch (error) {
        console.error("Accept admin order error:", error);

        return res.status(500).json({
            status: "ERROR",
            message: "Could not accept order"
        });
    }
};




export const rejectAdminOrder = async (req, res) => {
    const { id } = req.params;

    const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(id)) {
        return res.status(400).json({
            status: "ERROR",
            message: "Invalid order ID"
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const orderResult = await client.query(
            `
            UPDATE orders
            SET order_status = 'refund_pending'
            WHERE id = $1
              AND payment_status = 'paid'
              AND order_status = 'pending'
            RETURNING id, payment_status, order_status;
            `,
            [id]
        );

        if (orderResult.rowCount === 0) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                status: "ERROR",
                message: "Order cannot be rejected"
            });
        }

        const paymentResult = await client.query(
            `
            SELECT id, stripe_payment_intent_id
            FROM payments
            WHERE order_id = $1
              AND status = 'succeeded'
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE;
            `,
            [id]
        );

        if (
            paymentResult.rowCount === 0 ||
            !paymentResult.rows[0].stripe_payment_intent_id
        ) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                status: "ERROR",
                message: "Refundable payment not found"
            });
        }

        await client.query(
            `
            UPDATE payments
            SET status = 'refund_pending'
            WHERE id = $1;
            `,
            [paymentResult.rows[0].id]
        );


        const refundRequestResult = await client.query(
            `
    INSERT INTO refund_requests (
        order_id,
        payment_id,
        idempotency_key,
        status
    )
    VALUES ($1, $2, $3, 'pending')
    RETURNING id, status;
    `,
            [
                id,
                paymentResult.rows[0].id,
                `order-refund-${id}`
            ]
        );


        await client.query("COMMIT");


        return res.status(202).json({
            status: "GOOD",
            message: "Refund request registered",
            order: orderResult.rows[0],
            refundRequest: refundRequestResult.rows[0]
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Reject admin order error:", error);

        return res.status(500).json({
            status: "ERROR",
            message: "Could not reserve order refund"
        });
    } finally {
        client.release();
    }
};


