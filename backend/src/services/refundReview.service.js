/** Read-only review, NOT refund authorization and NOT a Stripe verification. */
export async function getRefundReview(database, orderId) {
  const orderResult = await database.query(
    `SELECT id, total, payment_status, order_status
       FROM orders WHERE id = $1`, [orderId]
  );
  if (!orderResult.rows.length) return null;
  const order = orderResult.rows[0];
  const payments = await database.query(
    `SELECT id, status, stripe_payment_intent_id, stripe_refund_id
       FROM payments WHERE order_id = $1 ORDER BY created_at DESC`, [orderId]
  );
  const isPaid = order.payment_status === "paid";
  const candidates = payments.rows.filter(p => p.stripe_payment_intent_id && ["paid", "succeeded", "refund_pending", "refunded"].includes(p.status));
  let reviewStatus;
  let message;
  if (!isPaid) {
    reviewStatus = "not_paid";
    message = "No confirmed order payment. Do not initiate a refund.";
  } else if (["cancelled", "completed"].includes(order.order_status)) {
    reviewStatus = "manual_review";
    message = "This order requires manual reconciliation before any refund.";
  } else if (candidates.length !== 1 || payments.rows.some(p => p.stripe_refund_id || p.status === "refund_pending" || p.status === "refunded")) {
    reviewStatus = "manual_review";
    message = "Payment history requires review before any refund.";
  } else {
    reviewStatus = "review_required";
    message = "Confirmed paid order. A refund would still require Stripe verification and explicit authorization.";
  }
  return {
    order_id: order.id, total: order.total,
    payment_status: order.payment_status, order_status: order.order_status,
    review_status: reviewStatus, message,
    payment_records: payments.rows.length,
    // Intentionally exclude Stripe IDs and credentials from the response.
    refunds_enabled: false
  };
}
