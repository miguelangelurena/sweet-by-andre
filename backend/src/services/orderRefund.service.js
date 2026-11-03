export class RefundError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

// First rollout: explicitly enabled Stripe sandbox only.
export function adminRefundsEnabled(env = process.env) {
  return env.ENABLE_ADMIN_REFUNDS === "true" &&
    env.STRIPE_SECRET_KEY?.startsWith("sk_test_") === true;
}

export function refundAmountCents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new RefundError("Invalid refund amount");
  const [whole, decimal = ""] = String(value).split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new RefundError("Invalid refund amount");
  return cents;
}

/** Durable request before Stripe. Lock the order to serialize acceptance/rejection. */
export async function reserveOrderRefund(database, orderId, actorId, reason) {
  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 500)
    throw new RefundError("Enter a rejection reason (1–500 characters)", 400);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const order = (await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [orderId])).rows[0];
    if (!order) throw new RefundError("Order not found", 404);
    const previous = (await client.query("SELECT * FROM refund_requests WHERE order_id=$1", [orderId])).rows[0];
    if (previous) {
      if (!["refund_pending", "cancelled"].includes(order.order_status))
        throw new RefundError("Refund history requires reconciliation");
      await client.query("COMMIT");
      return previous;
    }
    if (order.payment_status !== "paid" || order.order_status !== "pending")
      throw new RefundError("Only paid orders awaiting bakery acceptance can be rejected");
    const payments = await client.query("SELECT * FROM payments WHERE order_id=$1 FOR UPDATE", [orderId]);
    const payment = payments.rows[0];
    if (payments.rowCount !== 1 || payment.status !== "succeeded" ||
        !payment.stripe_payment_intent_id || payment.stripe_refund_id ||
        refundAmountCents(payment.amount) !== refundAmountCents(order.total))
      throw new RefundError("Payment history requires reconciliation");
    const result = await client.query(`INSERT INTO refund_requests
      (order_id,payment_id,idempotency_key,requested_by,reason)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [orderId, payment.id, `order-refund-${orderId}`, actorId, reason.trim()]);
    await client.query("UPDATE orders SET order_status='refund_pending',payment_status='refund_pending' WHERE id=$1", [orderId]);
    await client.query("UPDATE payments SET status='refund_pending' WHERE id=$1", [payment.id]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** Only verified webhooks or authenticated Stripe API responses may call this. */
export async function applyRefundUpdate(database, refund) {
  const intent = typeof refund?.payment_intent === "string" ? refund.payment_intent : refund?.payment_intent?.id;
  if (!refund?.id?.startsWith("re_") || !intent ||
      !["pending", "requires_action", "succeeded", "failed", "canceled"].includes(refund.status))
    throw new RefundError("Invalid Stripe refund", 400);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const lookup = (await client.query(`SELECT id,order_id FROM refund_requests
      WHERE stripe_refund_id=$1 OR id::text=$2`, [refund.id, refund.metadata?.refund_request_id ?? ""])).rows;
    if (lookup.length !== 1) throw new RefundError("Refund request not found");
    const order = (await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [lookup[0].order_id])).rows[0];
    const rr = (await client.query("SELECT * FROM refund_requests WHERE id=$1 FOR UPDATE", [lookup[0].id])).rows[0];
    const payment = (await client.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE", [rr.payment_id])).rows[0];
    if (!order || !payment || payment.order_id !== order.id ||
        payment.stripe_payment_intent_id !== intent || refund.currency !== "usd" ||
        refund.amount !== refundAmountCents(order.total) ||
        refund.amount !== refundAmountCents(payment.amount) ||
        (rr.stripe_refund_id && rr.stripe_refund_id !== refund.id) ||
        (refund.metadata?.order_id && refund.metadata.order_id !== order.id) ||
        (refund.metadata?.refund_request_id && refund.metadata.refund_request_id !== rr.id))
      throw new RefundError("Refund does not match the original payment", 400);
    if (rr.status === "succeeded") {
      if (rr.stripe_refund_id !== refund.id || order.payment_status !== "refunded" || payment.status !== "refunded")
        throw new RefundError("Completed refund requires reconciliation");
      // Banks can return a refund after Stripe initially reported success.
      // Keep the rejected order cancelled and returned resources unchanged,
      // but make the outstanding customer refund visible for manual review.
      if (["failed", "canceled"].includes(refund.status)) {
        await client.query(`UPDATE refund_requests SET status='failed',last_error=$2,updated_at=NOW() WHERE id=$1`,
          [rr.id, "Refund failed after prior success. Manual Stripe reconciliation is required."]);
        await client.query("UPDATE payments SET status='refund_pending' WHERE id=$1", [payment.id]);
        await client.query("UPDATE orders SET payment_status='refund_pending' WHERE id=$1", [order.id]);
        await client.query("COMMIT");
        return { status: "failed", refundId: refund.id, orderId: order.id };
      }
      await client.query("COMMIT");
      return { status: "succeeded", refundId: refund.id, orderId: order.id };
    }
    if (rr.status === "failed" && rr.resources_returned_at && order.order_status === "cancelled" &&
        order.payment_status === "refund_pending" && payment.status === "refund_pending") {
      // Ignore duplicate/stale updates after a post-success failure. A separate
      // manual resolution is required; never reopen or refund the order again.
      await client.query("COMMIT");
      return { status: "failed", refundId: refund.id, orderId: order.id };
    }
    if (order.order_status !== "refund_pending" || order.payment_status !== "refund_pending" || payment.status !== "refund_pending")
      throw new RefundError("Order is not awaiting this refund");
    const status = refund.status === "succeeded" ? "succeeded" :
      ["failed", "canceled"].includes(refund.status) ? "failed" : "processing";
    if (rr.status === "failed") {
      await client.query("COMMIT");
      return { status: "failed", refundId: refund.id, orderId: order.id };
    }
    await client.query(`UPDATE refund_requests SET stripe_refund_id=$2,status=$3,
      last_error=$4,updated_at=NOW() WHERE id=$1`,
    [rr.id, refund.id, status, status === "failed" ? "Stripe refund failed; manual review required" : null]);
    if (status === "succeeded") {
      // These orders have not been accepted/prepared. Return physical stock
      // once, retaining the committed reservation as historical sale evidence.
      if (!rr.resources_returned_at) {
        const rows = (await client.query(`SELECT variant_id,SUM(quantity)::int AS quantity
          FROM inventory_reservations WHERE order_id=$1 AND status='committed'
          AND inventory_mode='stock' GROUP BY variant_id ORDER BY variant_id`, [order.id])).rows;
        for (const row of rows) {
          const result = await client.query("UPDATE product_variants SET stock=stock+$2,updated_at=NOW() WHERE id=$1 RETURNING id", [row.variant_id, row.quantity]);
          if (result.rowCount !== 1) throw new RefundError("Stock return requires reconciliation");
        }
        await client.query("UPDATE refund_requests SET resources_returned_at=NOW() WHERE id=$1", [rr.id]);
      }
      await client.query("UPDATE payments SET status='refunded',stripe_refund_id=$2 WHERE id=$1", [payment.id, refund.id]);
      // Availability already excludes cancelled orders, freeing production
      // and delivery capacity without changing their immutable snapshots.
      await client.query("UPDATE orders SET order_status='cancelled',payment_status='refunded' WHERE id=$1", [order.id]);
    }
    await client.query("COMMIT");
    return { status, refundId: refund.id, orderId: order.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
