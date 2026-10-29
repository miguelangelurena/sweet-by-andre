import { getRefundReview } from "../services/refundReview.service.js";
import { cancelUnpaidOrder } from "../services/cancelUnpaidOrder.service.js";
import { transitionPaidOrder } from "../services/adminOrderWorkflow.service.js";

import { pool } from "../config/database.js";

// The optional query parameters support efficient server-side pagination.
// Requests without pagination parameters preserve the original API behavior.
export const getAdminOrders = async (req, res) => {
    try {
        const { limit: limitRaw, offset: offsetRaw, payment_status: paymentStatus,
            order_status: orderStatus, delivery_window: deliveryWindow, workload } = req.query;
        const paginated = limitRaw !== undefined || offsetRaw !== undefined;
        const paymentStates = new Set(["pending", "paid", "failed", "refund_pending", "refunded"]);
        const orderStates = new Set(["pending", "confirmed", "preparing", "ready", "completed", "cancelled"]);
        if ((paymentStatus !== undefined && !paymentStates.has(paymentStatus)) ||
            (orderStatus !== undefined && !orderStates.has(orderStatus)) ||
            (deliveryWindow !== undefined && !["today", "next7", "overdue"].includes(deliveryWindow)) ||
            (workload !== undefined && workload !== "active")) {
            return res.status(400).json({ status: "ERROR", message: "Invalid orders filter" });
        }
        const isPositiveInt = (value) => typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
        const rawLimit = limitRaw ?? "20";
        const rawOffset = offsetRaw ?? "0";
        if (!isPositiveInt(rawLimit) || !isPositiveInt(rawOffset)) {
            return res.status(400).json({ status: "ERROR", message: "Invalid pagination parameters" });
        }
        const limit = Number(rawLimit), offset = Number(rawOffset);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
            !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
            return res.status(400).json({ status: "ERROR", message: "Invalid pagination range" });
        }
        const conditions = [], values = [];
        if (paymentStatus !== undefined) {
            values.push(paymentStatus);
            conditions.push(`o.payment_status = $${values.length}`);
        }
        if (orderStatus !== undefined) {
            values.push(orderStatus);
            conditions.push(`o.order_status = $${values.length}`);
        }
        if (workload === "active") {
            conditions.push(`o.payment_status = 'paid' AND o.order_status IN ('pending','confirmed','preparing','ready')`);
        }
        // Filter by the date persisted on the order. Verify the DB timezone
        // and migrate delivery_date to TIMESTAMPTZ before production.
        const localDate = `o.delivery_date::date`;
        const today = `(CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date`;
        if (deliveryWindow === "today") conditions.push(`${localDate} = ${today}`);
        if (deliveryWindow === "next7") conditions.push(`${localDate} >= ${today} AND ${localDate} < ${today} + 7`);
        if (deliveryWindow === "overdue") conditions.push(`${localDate} < ${today}`);
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const count = await pool.query(`SELECT COUNT(*)::int AS total FROM orders o ${where}`, values);
        const total = count.rows[0].total;
        const pageSql = paginated ? `LIMIT $${values.length + 1} OFFSET $${values.length + 2}` : "";
        const params = paginated ? [...values, limit, offset] : values;
        const ordering = workload === "active" || deliveryWindow !== undefined
          ? "o.delivery_date ASC, o.id DESC" : "o.created_at DESC, o.id DESC";
        const result = await pool.query(`
            SELECT o.id, o.user_id, o.total, o.payment_status,
                   o.order_status, o.delivery_date, o.created_at,
                   o.shipping_name
            FROM orders o ${where}
            ORDER BY ${ordering}
            ${pageSql}
        `, params);
        return res.status(200).json({
            status: "GOOD", orders: result.rows,
            pagination: { total, limit: paginated ? limit : result.rows.length,
              offset: paginated ? offset : 0,
              has_more: paginated ? offset + result.rows.length < total : false }
        });
    } catch (error) {
        console.error("Get admin orders error:", error);
        return res.status(500).json({ status: "ERROR", message: "Could not retrieve orders" });
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




/**
 * Advance a paid order through fulfillment, one step at a time.
 * Payment status is never edited here. All mutable routes require admin
 * authentication AND a session-bound CSRF token in the router.
 */
export const advanceAdminOrderStatus = async (req, res) => {
    const { id } = req.params;
    const targetStatus = req.body?.target_status;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({
            status: "ERROR",
            message: "Invalid order ID"
        });
    }

    if (typeof targetStatus !== "string" ||
        !["confirmed", "preparing", "ready", "completed"].includes(targetStatus)) {
        return res.status(400).json({
            status: "ERROR",
            message: "Invalid target order status"
        });
    }

    try {
        const result = await transitionPaidOrder(pool, id, targetStatus);

        if (result.outcome === "not_found") {
            return res.status(404).json({ status: "ERROR", message: "Order not found" });
        }

        if (result.outcome === "conflict") {
            return res.status(409).json({
                status: "ERROR",
                message: result.order.payment_status !== "paid"
                    ? "Only paid orders can be advanced"
                    : "Order status has changed or the transition is not allowed. Refresh and try again."
            });
        }

        if (result.outcome !== "updated") {
            return res.status(400).json({ status: "ERROR", message: "Invalid order status" });
        }

        return res.status(200).json({
            status: "GOOD",
            message: "Order status updated",
            order: result.order
        });
    } catch (error) {
        console.error("Advance order status error:", error);
        return res.status(500).json({
            status: "ERROR",
            message: "Could not update order status"
        });
    }
};

/** Cancel an unpaid order ONLY before any payment or reservation activity. */
export const cancelUnpaidAdminOrder = async (req, res) => {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({ status: "ERROR", message: "Invalid order ID" });
    }
    try {
        const order = await cancelUnpaidOrder(pool, id);
        if (!order) {
            return res.status(409).json({
                status: "ERROR",
                message: "Cancellation unavailable. Only unpaid pending orders with no payment or reservation activity can be cancelled."
            });
        }
        return res.status(200).json({ status: "GOOD", message: "Unpaid order cancelled", order });
    } catch (error) {
        console.error("Cancel unpaid order error:", error);
        return res.status(500).json({ status: "ERROR", message: "Could not cancel order" });
    }
};


/** Safe inspection only. Never calls Stripe or writes any database record. */
export const reviewAdminOrderRefund = async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ status: "ERROR", message: "Invalid order ID" });
  }
  try {
    const review = await getRefundReview(pool, id);
    if (!review) return res.status(404).json({status:"ERROR",message:"Order not found"});
    return res.status(200).json({status:"GOOD",review});
  } catch (error) {
    console.error("Refund review error:", error);
    return res.status(500).json({status:"ERROR",message:"Could not inspect refund status"});
  }
};
