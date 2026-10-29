/**
 * Cancel only a never-started, unpaid order.
 * This does NOT cancel a Stripe payment, release reservations, or issue refunds.
 * Any record of payment/checkout activity requires separate reconciliation.
 */
export async function cancelUnpaidOrder(database, orderId) {
  const result = await database.query(`
    UPDATE orders AS o
    SET order_status = 'cancelled'
    WHERE o.id = $1
      AND o.order_status = 'pending'
      AND o.payment_status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM payments p WHERE p.order_id = o.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM checkout_attempts a WHERE a.order_id = o.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM inventory_reservations r WHERE r.order_id = o.id
      )
    RETURNING o.id, o.payment_status, o.order_status;
  `, [orderId]);
  return result.rows[0] ?? null;
}
