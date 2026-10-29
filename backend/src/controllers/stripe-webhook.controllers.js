
import { pool } from "../config/database.js";
import { stripe } from "../config/stripe.js";

import {
    confirmPaidCheckoutSession
} from "../services/checkoutPaymentConfirmation.service.js";

import {
    expireCheckoutSession
} from "../services/checkoutExpiration.service.js";

import {
    recoverPaidCheckoutAssociation
} from "../services/checkoutRecovery.service.js";

export const handleStripeWebhook = async (req, res) => {
    const signature = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
        return res.status(400).send(
            "Missing Stripe signature or webhook secret"
        );
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            webhookSecret
        );
    } catch (error) {
        console.error(
            "Invalid Stripe webhook signature:",
            error.message
        );

        return res.status(400).send(
            "Invalid webhook signature"
        );
    }

    console.log("Stripe webhook received:", {
        eventId: event.id,
        eventType: event.type
    });

    try {
        switch (event.type) {

            // ==========================================
            // CHECKOUT SESSION COMPLETED
            // ==========================================
            case "checkout.session.completed": {
                const session = event.data.object;

                console.log("Checkout session completed:", {
                    sessionId: session.id,
                    orderId: session.metadata?.order_id,
                    paymentStatus: session.payment_status
                });

                // Only finalize Checkout when Stripe
                // confirms that the payment was received.
                if (session.payment_status !== "paid") {
                    console.log(
                        "Checkout completed without confirmed payment:",
                        session.id
                    );

                    break;
                }

                // This service performs all operations
                // in one PostgreSQL transaction:
                //
                // 1. Lock the order.
                // 2. Validate the checkout attempt.
                // 3. Validate the payment and amount.
                // 4. Commit inventory reservations.
                // 5. Mark payment as succeeded.
                // 6. Mark order as paid.
                // 7. Mark checkout attempt as completed.
                //
                // Repeated events must not deduct stock twice.
                // Recover a Checkout Session that Stripe created
                // before our database saved its association.
                await recoverPaidCheckoutAssociation(session);

                // Confirm payment and inventory transactionally.
                const result = await confirmPaidCheckoutSession(session);

                console.log(
                    "Checkout confirmation processed:",
                    {
                        sessionId: session.id,
                        orderId: result.orderId,
                        status: result.status,
                        inventoryStatus:
                            result.inventoryStatus ?? null
                    }
                );

                break;
            }

            // ==========================================
            // CHECKOUT SESSION EXPIRED
            // ==========================================

            case "checkout.session.expired": {
                const session = event.data.object;

                console.log("Checkout session expired:", {
                    sessionId: session.id,
                    orderId: session.metadata?.order_id,
                    attemptId: session.metadata?.checkout_attempt_id
                });

                // The webhook signature was already verified.
                // The service checks the session association and
                // updates the payment, attempt and reservations
                // inside one PostgreSQL transaction.
                const result = await expireCheckoutSession(session);

                console.log("Checkout expiration processed:", {
                    sessionId: session.id,
                    orderId: result.orderId,
                    status: result.status,
                    releasedCount: result.releasedCount
                });

                break;
            }


            // ==========================================
            // REFUND UPDATED
            // ==========================================
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
                        JOIN payments p
                            ON p.id = rr.payment_id
                        JOIN orders o
                            ON o.id = rr.order_id
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

                        console.error(
                            "Refund request not found:",
                            refund.id
                        );

                        return res.status(500).send(
                            "Refund request not found"
                        );
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
                        refundPaymentIntent !==
                        refundRequest.stripe_payment_intent_id ||
                        refund.amount !== expectedAmount ||
                        refund.currency?.toLowerCase() !== "usd"
                    ) {
                        await client.query("ROLLBACK");

                        console.error(
                            "Refund validation failed:",
                            refund.id
                        );

                        return res.status(400).send(
                            "Refund does not match the original payment"
                        );
                    }

                    // Idempotency:
                    // A completed refund must not be applied twice.
                    if (refundRequest.status === "succeeded") {
                        await client.query("COMMIT");
                        break;
                    }

                    // Update the refund request.
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
                                : ["failed", "canceled"].includes(
                                    refund.status
                                )
                                    ? "failed"
                                    : "processing"
                        ]
                    );

                    // Update the corresponding payment
                    // and order after a successful refund.
                    if (refund.status === "succeeded") {
                        await client.query(
                            `
                            UPDATE payments
                            SET status = 'refunded',
                                stripe_refund_id = $2
                            WHERE id = $1;
                            `,
                            [
                                refundRequest.payment_id,
                                refund.id
                            ]
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

            // ==========================================
            // OTHER STRIPE EVENTS
            // ==========================================
            default:
                // Acknowledge unhandled events without
                // making changes to orders or payments.
                break;
        }

        return res.status(200).json({
            received: true
        });

    } catch (error) {
        console.error(
            "Stripe webhook processing failed:",
            error
        );

        // Returning 500 allows Stripe to retry
        // webhook delivery.
        return res.status(500).send(
            "Webhook processing failed"
        );
    }
};
