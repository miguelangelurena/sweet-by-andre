
import { pool } from "../config/database.js";
import { commitOrderProduction } from "./production.service.js";

import {
    commitInventoryForOrder
} from "./inventoryReservation.service.js";

export class CheckoutConfirmationError extends Error {
    constructor(message, status = 409) {
        super(message);
        this.name = "CheckoutConfirmationError";
        this.status = status;
    }
}

const UUID_RE =
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function amountToCents(value) {
    const amount = String(value);

    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
        throw new CheckoutConfirmationError(
            "Invalid stored payment amount"
        );
    }

    const [whole, fraction = ""] = amount.split(".");

    const cents =
        Number(whole) * 100 +
        Number(fraction.padEnd(2, "0"));

    if (!Number.isSafeInteger(cents) || cents <= 0) {
        throw new CheckoutConfirmationError(
            "Invalid stored payment amount"
        );
    }

    return cents;
}

/**
 * Finalizes a confirmed Stripe Checkout payment.
 *
 * Caller must supply a Stripe session from a verified
 * webhook or another trusted Stripe API response.
 *
 * Never call this directly using client-provided JSON.
 */
export async function confirmPaidCheckoutSession(session) {
    const orderId = session?.metadata?.order_id;
    const attemptId = session?.metadata?.checkout_attempt_id;

    const paymentIntentId =
        typeof session?.payment_intent === "string"
            ? session.payment_intent
            : session?.payment_intent?.id;

    if (
        session?.object !== "checkout.session" ||
        session?.mode !== "payment" ||
        session?.status !== "complete" ||
        session?.payment_status !== "paid" ||
        session?.currency?.toLowerCase() !== "usd" ||
        !Number.isSafeInteger(session?.amount_total) ||
        session.amount_total <= 0 ||
        typeof session.id !== "string" ||
        !/^cs_(test|live)_[A-Za-z0-9]+$/.test(session.id) ||
        !UUID_RE.test(orderId ?? "") ||
        !UUID_RE.test(attemptId ?? "") ||
        typeof paymentIntentId !== "string" ||
        !paymentIntentId.startsWith("pi_")
    ) {
        throw new CheckoutConfirmationError(
            "Invalid or unconfirmed Checkout session",
            400
        );
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1. Always lock the order first.
        const orderResult = await client.query(
            `
            SELECT id, total, payment_status, order_status
            FROM orders
            WHERE id = $1
            FOR UPDATE
            `,
            [orderId]
        );

        if (orderResult.rowCount !== 1) {
            throw new CheckoutConfirmationError(
                "Checkout order not found",
                404
            );
        }

        const order = orderResult.rows[0];

        // 2. Lock the corresponding attempt.
        const attemptResult = await client.query(
            `
            SELECT
                id,
                order_id,
                payment_id,
                stripe_session_id,
                status
            FROM checkout_attempts
            WHERE id = $1
              AND order_id = $2
            FOR UPDATE
            `,
            [attemptId, orderId]
        );

        if (attemptResult.rowCount !== 1) {
            throw new CheckoutConfirmationError(
                "Checkout attempt requires reconciliation"
            );
        }

        const attempt = attemptResult.rows[0];

        if (
            attempt.stripe_session_id !== session.id ||
            !attempt.payment_id
        ) {
            throw new CheckoutConfirmationError(
                "Checkout session association requires reconciliation"
            );
        }

        // 3. Lock the payment after the order and attempt.
        const paymentResult = await client.query(
            `
            SELECT
                id,
                order_id,
                status,
                amount,
                stripe_payment_id,
                stripe_payment_intent_id
            FROM payments
            WHERE id = $1
            FOR UPDATE
            `,
            [attempt.payment_id]
        );

        if (paymentResult.rowCount !== 1) {
            throw new CheckoutConfirmationError(
                "Checkout payment requires reconciliation"
            );
        }

        const payment = paymentResult.rows[0];

        // 4. Validate identities and financial values.
        if (
            payment.order_id !== orderId ||
            payment.stripe_payment_id !== session.id ||
            amountToCents(order.total) !== session.amount_total ||
            amountToCents(payment.amount) !== session.amount_total
        ) {
            throw new CheckoutConfirmationError(
                "Checkout payment amount or identity mismatch"
            );
        }

        if (
            payment.stripe_payment_intent_id &&
            payment.stripe_payment_intent_id !== paymentIntentId
        ) {
            throw new CheckoutConfirmationError(
                "Checkout PaymentIntent mismatch"
            );
        }

        // 5. Repeated webhook delivery is a no-op.
        // Also allow previously finalized payments that
        // have subsequently entered the refund workflow.
        if (attempt.status === "completed") {
            if (
                !["succeeded", "refund_pending", "refunded"]
                    .includes(payment.status) ||
                !["paid", "refund_pending", "refunded"]
                    .includes(order.payment_status) ||
                payment.stripe_payment_intent_id !== paymentIntentId
            ) {
                throw new CheckoutConfirmationError(
                    "Completed Checkout has inconsistent state"
                );
            }

            const inventory =
                await commitInventoryForOrder(client, orderId);
            await commitOrderProduction(client, orderId);

            if (inventory.status !== "already_committed") {
                throw new CheckoutConfirmationError(
                    "Completed Checkout had uncommitted inventory"
                );
            }

            await client.query("COMMIT");

            return {
                status: "already_completed",
                orderId,
                paymentId: payment.id
            };
        }

        if (
            attempt.status !== "open" ||
            payment.status !== "pending" ||
            order.payment_status !== "pending" ||
            order.order_status !== "pending"
        ) {
            throw new CheckoutConfirmationError(
                "Checkout is not eligible for confirmation"
            );
        }

        // 6. Commit inventory using the SAME transaction.
        const inventory =
            await commitInventoryForOrder(client, orderId);
        await commitOrderProduction(client, orderId);

        if (inventory.status !== "committed") {
            throw new CheckoutConfirmationError(
                "Unexpected inventory confirmation state"
            );
        }

        // 7. Update the payment.
        const paymentUpdate = await client.query(
            `
            UPDATE payments
            SET status = 'succeeded',
                stripe_payment_intent_id = $2
            WHERE id = $1
              AND status = 'pending'
            RETURNING id
            `,
            [payment.id, paymentIntentId]
        );

        if (paymentUpdate.rowCount !== 1) {
            throw new CheckoutConfirmationError(
                "Could not confirm payment"
            );
        }

        // 8. Mark the order paid.
        const orderUpdate = await client.query(
            `
            UPDATE orders
            SET payment_status = 'paid'
            WHERE id = $1
              AND payment_status = 'pending'
            RETURNING id
            `,
            [orderId]
        );

        if (orderUpdate.rowCount !== 1) {
            throw new CheckoutConfirmationError(
                "Could not mark order paid"
            );
        }

        // 9. Complete the Checkout attempt.
        const attemptUpdate = await client.query(
            `
            UPDATE checkout_attempts
            SET status = 'completed',
                updated_at = NOW()
            WHERE id = $1
              AND status = 'open'
            RETURNING id
            `,
            [attemptId]
        );

        if (attemptUpdate.rowCount !== 1) {
            throw new CheckoutConfirmationError(
                "Could not complete Checkout attempt"
            );
        }

        await client.query("COMMIT");

        return {
            status: "completed",
            orderId,
            paymentId: payment.id,
            inventoryStatus: inventory.status
        };

    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally {
        client.release();
    }
}
