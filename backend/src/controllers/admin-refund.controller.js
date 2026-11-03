import { pool } from "../config/database.js";
import { adminRefundsEnabled, reserveOrderRefund, RefundError } from "../services/orderRefund.service.js";
import { processRefund } from "../services/refund.service.js";

export async function rejectPaidOrder(req, res) {
  if (!adminRefundsEnabled()) return res.status(503).json({ status: "ERROR", message: "Administrative refunds are disabled" });
  const id = req.params.id;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    return res.status(400).json({ status: "ERROR", message: "Invalid order ID" });
  let refundRequest;
  try {
    refundRequest = await reserveOrderRefund(pool, id, req.user.id, req.body?.reason);
  } catch (error) {
    if (!(error instanceof RefundError)) console.error("Reserve refund failed:", error.code ?? error.name);
    return res.status(error instanceof RefundError ? error.status : 500).json({
      status: "ERROR", message: error instanceof RefundError ? error.message : "Could not register refund request"
    });
  }
  try {
    await processRefund(refundRequest.id);
  } catch (error) {
    // The request is durable. A timeout never authorizes a second refund key.
    console.error("Refund requires retry/review:", error.code ?? error.type ?? error.name);
    await pool.query("UPDATE refund_requests SET last_error=$2,updated_at=NOW() WHERE id=$1 AND status<>'succeeded'",
      [refundRequest.id, "Refund verification incomplete. Retry the existing request or review in Stripe."]);
  }
  const { refund_status, ...order } = (await pool.query(`SELECT o.id,o.payment_status,o.order_status,rr.status AS refund_status
    FROM orders o JOIN refund_requests rr ON rr.order_id=o.id WHERE o.id=$1`, [id])).rows[0];
  return res.status(refund_status === "succeeded" ? 200 : 202).json({
    status: "GOOD", order,
    refund_status,
    message: refund_status === "succeeded" ? "Order rejected and fully refunded." :
      refund_status === "failed" ? "Refund failed. Manual review is required; do not issue another refund." :
        "Refund requested. Check its status before retrying; do not refund separately in Stripe."
  });
}
