
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

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object;

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
                        SET status = 'succeeded'
                        WHERE stripe_payment_id = $1
                          AND status <> 'succeeded';
                        `,
                        [session.id]
                    );

                    await client.query(
                        `
UPDATE orders
SET payment_status = 'paid',
    order_status = CASE
        WHEN order_status = 'cancelled' THEN 'cancelled'
        ELSE 'confirmed'
    END
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
