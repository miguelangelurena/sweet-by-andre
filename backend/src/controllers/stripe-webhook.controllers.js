
import { pool } from "../config/database.js";
import { stripe } from "../config/stripe.js";

export const handleStripeWebhook = async (req, res) => {
    const signature = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
        return res.status(400).send("Missing Stripe signature or webhook secret");
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            webhookSecret
        );
    } catch (error) {
        console.error("Invalid Stripe webhook signature:", error.message);
        return res.status(400).send("Invalid webhook signature");
    }

    console.log("Stripe webhook received:", {
        eventId: event.id,
        eventType: event.type
    });

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object;

                console.log("Checkout session completed:", {
                    sessionId: session.id,
                    orderId: session.metadata?.order_id,
                    paymentStatus: session.payment_status
                });

                // Only process sessions whose payment is confirmed.
                if (session.payment_status !== "paid") {
                    break;
                }

                const orderId = session.metadata?.order_id;

                if (!orderId) {
                    console.error("Checkout session has no order_id metadata");
                    return res.status(400).send("Missing order metadata");
                }

                const client = await pool.connect();

                try {
                    await client.query("BEGIN");

                    // Lock the matching payment row to avoid concurrent updates.
                    const paymentResult = await client.query(
                        `
                        SELECT order_id, status
                        FROM payments
                        WHERE stripe_payment_id = $1
                        FOR UPDATE;
                        `,
                        [session.id]
                    );

                    if (paymentResult.rows.length === 0) {
                        await client.query("ROLLBACK");
                        console.error("No payment record for Checkout Session:", session.id);
                        return res.status(500).send("Payment record not found");
                    }

                    const payment = paymentResult.rows[0];

                    // Confirm the Checkout Session belongs to the order in metadata.
                    if (payment.order_id !== orderId) {
                        await client.query("ROLLBACK");
                        console.error("Checkout Session order mismatch:", session.id);
                        return res.status(400).send("Order mismatch");
                    }

                    // Repeated delivery is safe: applying the same status again
                    // does not create an additional payment or order.


                    await client.query(
                        `
    UPDATE payments
    SET status = 'succeeded',
        stripe_payment_intent_id = $2
    WHERE stripe_payment_id = $1
      AND status IN ('pending', 'succeeded');
    `,
                        [
                            session.id,
                            typeof session.payment_intent === "string"
                                ? session.payment_intent
                                : session.payment_intent?.id ?? null
                        ]
                    );




                    await client.query(
                        `
    UPDATE orders
    SET payment_status = 'paid'
    WHERE id = $1;
    `,
                        [orderId]
                    );


                    await client.query("COMMIT");
                } catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                } finally {
                    client.release();
                }

                break;
            }


            case "checkout.session.expired": {
                const session = event.data.object;

                const result = await pool.query(
                    `
                    UPDATE payments
                    SET status = 'failed'
                    WHERE stripe_payment_id = $1
                      AND status = 'pending'
                    RETURNING order_id;
                    `,
                    [session.id]
                );

                if (result.rowCount > 0) {
                    console.log("Checkout session expired:", {
                        sessionId: session.id,
                        orderId: result.rows[0].order_id
                    });
                }

                break;
            }


            case "refund.updated": {
                const refund = event.data.object;

                const client = await pool.connect();

                try {
                    await client.query("BEGIN");

                    const requestResult = await client.query(
                        `

SELECT
    rr.id,
    rr.order_id,
    rr.payment_id,
    rr.status,
    p.stripe_payment_intent_id,
    o.total
FROM refund_requests rr
JOIN payments p ON p.id = rr.payment_id
JOIN orders o ON o.id = rr.order_id
WHERE rr.stripe_refund_id = $1
   OR (
       rr.id::text = $2
       AND rr.stripe_refund_id IS NULL
   )
FOR UPDATE;
            `,
                        [
                            refund.id,
                            refund.metadata?.refund_request_id ?? ""
                        ]
                    );

                    if (requestResult.rowCount === 0) {
                        await client.query("ROLLBACK");
                        console.error("Refund request not found:", refund.id);
                        return res.status(500).send("Refund request not found");
                    }

                    const refundRequest = requestResult.rows[0];


                    const expectedAmount = Math.round(
                        Number(refundRequest.total) * 100
                    );

                    const refundPaymentIntent =
                        typeof refund.payment_intent === "string"
                            ? refund.payment_intent
                            : refund.payment_intent?.id;

                    if (
                        refundPaymentIntent !== refundRequest.stripe_payment_intent_id ||
                        refund.amount !== expectedAmount ||
                        refund.currency?.toLowerCase() !== "usd"
                    ) {
                        await client.query("ROLLBACK");

                        console.error("Refund validation failed:", refund.id);

                        return res.status(400).send(
                            "Refund does not match the original payment"
                        );
                    }



                    if (refundRequest.status === "succeeded") {
                        await client.query("COMMIT");
                        break;
                    }


                    await client.query(
                        `
            UPDATE refund_requests
            SET stripe_refund_id = $2,
                status = $3,
                updated_at = NOW()
            WHERE id = $1;
            `,
                        [
                            refundRequest.id,
                            refund.id,
                            refund.status === "succeeded"
                                ? "succeeded"
                                : ["failed", "canceled"].includes(refund.status)
                                    ? "failed"
                                    : "processing"
                        ]
                    );

                    if (refund.status === "succeeded") {
                        await client.query(
                            `
                UPDATE payments
                SET status = 'refunded',
                    stripe_refund_id = $2
                WHERE id = $1;
                `,
                            [refundRequest.payment_id, refund.id]
                        );

                        await client.query(
                            `
                UPDATE orders
                SET order_status = 'cancelled'
                WHERE id = $1
                  AND order_status = 'refund_pending';
                `,
                            [refundRequest.order_id]
                        );
                    }

                    await client.query("COMMIT");
                } catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                } finally {
                    client.release();
                }

                break;
            }


            default:
                // Acknowledge other event types without changing the order.
                break;
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        console.error("Stripe webhook processing failed:", error);
        return res.status(500).send("Webhook processing failed");
    }
};
