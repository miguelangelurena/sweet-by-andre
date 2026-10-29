import { pool } from "../config/database.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read-only status for orders owned by the current guest cart.
// An order UUID or Stripe session_id by itself never authorizes access.
export async function getGuestOrderStatus(req, res) {
  const orderId = req.params.orderId;
  if (!UUID_RE.test(orderId)) {
    return res.status(400).json({ status: "ERROR", message: "Invalid order ID" });
  }
  if (!req.cartId) {
    return res.status(401).json({ status: "ERROR", message: "Guest cart not authorized" });
  }
  try {
    const result = await pool.query(
      `SELECT id, total, payment_status, order_status
       FROM orders
       WHERE id = $1 AND guest_cart_id = $2 AND user_id IS NULL`,
      [orderId, req.cartId]
    );
    res.set("Cache-Control", "no-store");
    if (!result.rowCount) {
      return res.status(404).json({ status: "ERROR", message: "Order not found" });
    }
    return res.status(200).json({ status: "GOOD", order: result.rows[0] });
  } catch (error) {
    console.error("Guest order status failed:", error);
    return res.status(500).json({ status: "ERROR", message: "Could not read order status" });
  }
}
