
import { pool } from "../config/database.js";
import { stripe } from "../config/stripe.js";

const getRefundStatus = (status) => {
    if (status === "succeeded") return "succeeded";

    if (status === "failed" || status === "canceled") {
        return "failed";
    }

    return "processing";
};


export const processRefund = async (
    refundRequestId,
    dependencies = {}
) => {
    const database = dependencies.database ?? pool;
    const stripeClient = dependencies.stripeClient ?? stripe;

    const client = await database.connect();

    try {
        await client.query("BEGIN");

        const result = await client.query(
            `
            SELECT
                rr.id,
                rr.order_id,
                rr.payment_id,
                rr.idempotency_key,
                rr.status,
                rr.stripe_refund_id,
                p.stripe_payment_intent_id,
                o.total
            FROM refund_requests rr
            JOIN payments p ON p.id = rr.payment_id
            JOIN orders o ON o.id = rr.order_id
            WHERE rr.id = $1
            FOR UPDATE OF rr;
            `,
            [refundRequestId]
        );

        if (result.rowCount === 0) {
            throw new Error("Refund request not found");
        }

        const request = result.rows[0];

        if (request.status === "succeeded") {
            await client.query("COMMIT");

            return {
                status: "succeeded",
                refundId: request.stripe_refund_id
            };
        }

        if (!request.stripe_payment_intent_id) {
            throw new Error("PaymentIntent not found");
        }

        const paymentIntent = await stripeClient.paymentIntents.retrieve(
            request.stripe_payment_intent_id
        );

        const expectedAmount = Math.round(
            Number(request.total) * 100
        );

        if (
            paymentIntent.currency !== "usd" ||
            paymentIntent.amount_received !== expectedAmount
        ) {
            throw new Error("Payment amount or currency mismatch");
        }

        let refund = null;

        if (request.stripe_refund_id) {
            refund = await stripeClient.refunds.retrieve(
                request.stripe_refund_id
            );
        } else {
            const existingRefunds = await stripeClient.refunds.list({
                payment_intent: request.stripe_payment_intent_id,
                limit: 100
            });

            refund = existingRefunds.data.find(
                (item) =>
                    item.metadata?.refund_request_id === request.id
            );

            if (!refund) {
                if (existingRefunds.has_more) {
                    throw new Error(
                        "Refund history requires manual reconciliation"
                    );
                }

                if (existingRefunds.data.length > 0) {
                    throw new Error(
                        "Existing refund requires manual review"
                    );
                }

                if (paymentIntent.status !== "succeeded") {
                    throw new Error(
                        "PaymentIntent is not eligible for refund"
                    );
                }

                refund = await stripeClient.refunds.create(
                    {
                        payment_intent: request.stripe_payment_intent_id,
                        metadata: {
                            order_id: request.order_id,
                            refund_request_id: request.id
                        }
                    },
                    {
                        idempotencyKey: request.idempotency_key
                    }
                );
            }
        }

        const refundPaymentIntent =
            typeof refund.payment_intent === "string"
                ? refund.payment_intent
                : refund.payment_intent?.id;

        if (
            refundPaymentIntent !== request.stripe_payment_intent_id ||
            refund.amount !== expectedAmount ||
            refund.currency?.toLowerCase() !== "usd"
        ) {
            throw new Error("Refund details do not match payment");
        }

        const status = getRefundStatus(refund.status);

        await client.query(
            `
            UPDATE refund_requests
            SET stripe_refund_id = $2,
                status = $3,
                updated_at = NOW()
            WHERE id = $1
              AND status <> 'succeeded';
            `,
            [request.id, refund.id, status]
        );

        if (status === "succeeded") {
            await client.query(
                `
                UPDATE payments
                SET status = 'refunded',
                    stripe_refund_id = $2
                WHERE id = $1
                  AND status IN ('refund_pending', 'refunded');
                `,
                [request.payment_id, refund.id]
            );

            await client.query(
                `
                UPDATE orders
                SET order_status = 'cancelled'
                WHERE id = $1
                  AND order_status = 'refund_pending';
                `,
                [request.order_id]
            );
        }

        await client.query("COMMIT");

        return {
            status: refund.status,
            refundId: refund.id
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};
