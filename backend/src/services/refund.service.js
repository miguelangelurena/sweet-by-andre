import { pool } from "../config/database.js";
import { stripe } from "../config/stripe.js";
import { applyRefundUpdate, refundAmountCents, RefundError } from "./orderRefund.service.js";

export async function processRefund(refundRequestId, dependencies = {}) {
  const database = dependencies.database ?? pool;
  const stripeClient = dependencies.stripeClient ?? stripe;
  // No database transaction or row locks across the Stripe network requests.
  const client = await database.connect();
  let rr;
  try {
    rr = (await client.query(`SELECT rr.*,p.stripe_payment_intent_id,o.total
      FROM refund_requests rr JOIN payments p ON p.id=rr.payment_id
      JOIN orders o ON o.id=rr.order_id WHERE rr.id=$1`, [refundRequestId])).rows[0];
  } finally { client.release(); }
  if (!rr) throw new RefundError("Refund request not found", 404);
  if (rr.status === "succeeded") return { status: "succeeded", refundId: rr.stripe_refund_id };
  if (!rr.stripe_payment_intent_id) throw new RefundError("PaymentIntent not found");
  const pi = await stripeClient.paymentIntents.retrieve(rr.stripe_payment_intent_id);
  const amount = refundAmountCents(rr.total);
  if (pi.livemode === true || pi.currency !== "usd" || pi.amount_received !== amount || pi.status !== "succeeded")
    throw new RefundError("Payment amount or currency mismatch");
  let refund;
  if (rr.stripe_refund_id) {
    refund = await stripeClient.refunds.retrieve(rr.stripe_refund_id);
  } else {
    const history = await stripeClient.refunds.list({ payment_intent: rr.stripe_payment_intent_id, limit: 100 });
    if (history.has_more || history.data.some(r => r.metadata?.refund_request_id !== rr.id))
      throw new RefundError("Existing refund requires manual review");
    if (history.data.length > 1) throw new RefundError("Refund history requires manual review");
    refund = history.data[0] ?? await stripeClient.refunds.create({
      payment_intent: rr.stripe_payment_intent_id,
      amount,
      metadata: { order_id: rr.order_id, refund_request_id: rr.id }
    }, { idempotencyKey: rr.idempotency_key });
  }
  return (dependencies.applyRefund ?? applyRefundUpdate)(database, refund);
}
