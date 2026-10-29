/**
 * Order fulfillment is separate from payment. Never allow an admin action to
 * mark an order as paid or to bypass the sequential fulfillment workflow.
 *
 * Each update is conditional on the immediately preceding status AND an
 * already-confirmed payment. PostgreSQL serializes competing UPDATEs on the
 * same order, so only one transition can succeed.
 */
export const ALLOWED_FULFILLMENT_TRANSITIONS = Object.freeze({
  confirmed: "pending",
  preparing: "confirmed",
  ready: "preparing",
  completed: "ready",
});

export async function transitionPaidOrder(db, orderId, targetStatus) {
  if (!Object.hasOwn(ALLOWED_FULFILLMENT_TRANSITIONS, targetStatus)) {
    return { outcome: "invalid_status" };
  }

  const previousStatus = ALLOWED_FULFILLMENT_TRANSITIONS[targetStatus];
  const updated = await db.query(
    `
    UPDATE orders
    SET order_status = $3
    WHERE id = $1
      AND payment_status = 'paid'
      AND order_status = $2
    RETURNING id, payment_status, order_status;
    `,
    [orderId, previousStatus, targetStatus],
  );

  if (updated.rowCount === 1) {
    return { outcome: "updated", order: updated.rows[0] };
  }

  const current = await db.query(
    `SELECT id, payment_status, order_status FROM orders WHERE id = $1`,
    [orderId],
  );

  if (current.rowCount === 0) return { outcome: "not_found" };

  return { outcome: "conflict", order: current.rows[0] };
}
