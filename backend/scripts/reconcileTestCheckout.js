import "dotenv/config";
import { pool } from "../src/config/database.js";
import { stripe } from "../src/config/stripe.js";
import { recoverPaidCheckoutAssociation } from "../src/services/checkoutRecovery.service.js";
import { confirmPaidCheckoutSession } from "../src/services/checkoutPaymentConfirmation.service.js";

// Recover a missed local test webhook from an authoritative Stripe API read.
// Never fabricate a webhook or set payment_status directly.
try {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Requires a Stripe test key");
  const database = await pool.query("SELECT current_database() AS name");
  if (!["sweet_by_andre_dev", "sweet_by_andre_test"].includes(database.rows[0].name)) {
    throw new Error("Reconciliation is restricted to local development and test databases");
  }
  const orderId = process.argv[2];
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(orderId ?? "")) {
    throw new Error("Usage: npm run stripe:reconcile-test -- <order UUID>");
  }
  const attempts = await pool.query(
    `SELECT stripe_session_id FROM checkout_attempts
     WHERE order_id = $1 AND stripe_session_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [orderId],
  );
  if (!attempts.rowCount) throw new Error("Order has no linked Stripe session");
  const session = await stripe.checkout.sessions.retrieve(attempts.rows[0].stripe_session_id);
  if (session.livemode !== false || session.status !== "complete" ||
      session.payment_status !== "paid" || session.metadata?.order_id !== orderId) {
    throw new Error("Stripe has not confirmed a completed test payment for this order");
  }
  await recoverPaidCheckoutAssociation(session);
  const result = await confirmPaidCheckoutSession(session);
  console.log(JSON.stringify({ orderId, status: result.status, inventoryStatus: result.inventoryStatus }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
