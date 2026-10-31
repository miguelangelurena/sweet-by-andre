
import { pool } from "../config/database.js";
import { releaseOrderProduction } from "./production.service.js";

export class CheckoutExpirationError extends Error {
    constructor(message, status = 409) {
        super(message);
        this.name = "CheckoutExpirationError";
        this.status = status;
    }
}

const UUID_RE =
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * Processes an authenticated Stripe Checkout expiration.
 *
 * Call only after validating the Stripe webhook signature,
 * or with a session retrieved securely from Stripe.
 *
 * All database changes share one transaction.
 */
export async function expireCheckoutSession(session) {
    const orderId = session?.metadata?.order_id;
    const attemptId =
        session?.metadata?.checkout_attempt_id;

    if (
        session?.object !== "checkout.session" ||
        session?.status !== "expired" ||
        session?.payment_status !== "unpaid" ||
        typeof session?.id !== "string" ||
        !/^cs_(test|live)_[A-Za-z0-9]+$/.test(session.id) ||
        !UUID_RE.test(orderId ?? "") ||
        !UUID_RE.test(attemptId ?? "")
    ) {
        throw new CheckoutExpirationError(
            "Invalid Checkout expiration event",
            400
        );
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1. Lock the order first, consistently
        // with our payment confirmation services.
        const orderResult = await client.query(
            `
            SELECT id, payment_status, order_status
            FROM orders
            WHERE id = $1
            FOR UPDATE
            `,
            [orderId]
        );

        if (orderResult.rowCount !== 1) {
            throw new CheckoutExpirationError(
                "Checkout order not found",
                404
            );
        }

        const order = orderResult.rows[0];

        // 2. Lock the matching Checkout attempt.
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
            throw new CheckoutExpirationError(
                "Checkout attempt requires reconciliation"
            );
        }

        const attempt = attemptResult.rows[0];

        if (
            attempt.stripe_session_id !== session.id ||
            !attempt.payment_id
        ) {
            throw new CheckoutExpirationError(
                "Checkout session association requires reconciliation"
            );
        }

        // 3. Lock the local payment.
        const paymentResult = await client.query(
            `
            SELECT
                id,
                order_id,
                status,
                stripe_payment_id
            FROM payments
            WHERE id = $1
            FOR UPDATE
            `,
            [attempt.payment_id]
        );

        if (paymentResult.rowCount !== 1) {
            throw new CheckoutExpirationError(
                "Checkout payment not found"
            );
        }

        const payment = paymentResult.rows[0];

        if (
            payment.order_id !== orderId ||
            payment.stripe_payment_id !== session.id
        ) {
            throw new CheckoutExpirationError(
                "Checkout payment association mismatch"
            );
        }

        // 4. Lock existing reservations.
        const reservationResult = await client.query(
            `
            SELECT id, status
            FROM inventory_reservations
            WHERE order_id = $1
            ORDER BY variant_id
            FOR UPDATE
            `,
            [orderId]
        );

        const reservations = reservationResult.rows;

        if (!reservations.length) {
            throw new CheckoutExpirationError(
                "Checkout has no inventory reservations"
            );
        }

        // 5. Duplicate expiration: no further changes.
        if (attempt.status === "expired") {
            if (
                payment.status !== "failed" ||
                order.payment_status !== "pending" ||
                reservations.some(
                    reservation =>
                        reservation.status !== "released"
                )
            ) {
                throw new CheckoutExpirationError(
                    "Expired Checkout has inconsistent state"
                );
            }

            await client.query("COMMIT");

            return {
                status: "already_expired",
                orderId,
                releasedCount: 0
            };
        }

        // Never release stock for a paid, completed,
        // cancelled, or otherwise inconsistent checkout.
        if (
            attempt.status !== "open" ||
            payment.status !== "pending" ||
            order.payment_status !== "pending" ||
            order.order_status !== "pending" ||
            reservations.some(
                reservation =>
                    reservation.status !== "reserved"
            )
        ) {
            throw new CheckoutExpirationError(
                "Checkout cannot be expired safely"
            );
        }

        // 6. Release reservations WITHOUT increasing
        // physical stock, since stock was never deducted.
        const released = await client.query(
            `
            UPDATE inventory_reservations
            SET status = 'released',
                updated_at = NOW()
            WHERE order_id = $1
              AND status = 'reserved'
            RETURNING id
            `,
            [orderId]
        );

        if (released.rowCount !== reservations.length) {
            throw new CheckoutExpirationError(
                "Inventory reservation release failed"
            );
        }

        // 7. Mark the payment failed.
        const paymentUpdate = await client.query(
            `
            UPDATE payments
            SET status = 'failed'
            WHERE id = $1
              AND status = 'pending'
            RETURNING id
            `,
            [payment.id]
        );

        if (paymentUpdate.rowCount !== 1) {
            throw new CheckoutExpirationError(
                "Could not expire Checkout payment"
            );
        }

        // 8. Expire the Checkout attempt.
        const attemptUpdate = await client.query(
            `
            UPDATE checkout_attempts
            SET status = 'expired',
                updated_at = NOW()
            WHERE id = $1
              AND status = 'open'
            RETURNING id
            `,
            [attempt.id]
        );

        if (attemptUpdate.rowCount !== 1) {
            throw new CheckoutExpirationError(
                "Could not expire Checkout attempt"
            );
        }

        await releaseOrderProduction(client, orderId);
        await client.query("COMMIT");

        return {
            status: "expired",
            orderId,
            releasedCount: released.rowCount
        };

    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;

    } finally {
        client.release();
    }
}
