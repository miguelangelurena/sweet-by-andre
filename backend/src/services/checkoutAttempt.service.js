
import { pool } from "../config/database.js";
import { reserveOrderDelivery } from "./delivery.service.js";
import { reserveOrderProduction } from "./production.service.js";

import {
    reserveInventoryForOrder
} from "./inventoryReservation.service.js";

export class CheckoutAttemptError extends Error {
    constructor(message, status = 409) {
        super(message);
        this.name = "CheckoutAttemptError";
        this.status = status;
    }
}

/**
 * Prepares a checkout attempt without contacting Stripe.
 *
 * The caller must have already authorized ownership
 * of the order.
 *
 * Ownership is checked again inside the transaction.
 *
 * This service does not create payment records.
 */
export async function prepareCheckoutAttempt({
    orderId,
    userId = null,
    guestCartId = null
}) {
    if (Boolean(userId) === Boolean(guestCartId)) {
        throw new CheckoutAttemptError(
            "Checkout identity is invalid",
            401
        );
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1. Lock the order and verify ownership.
        const orderResult = await client.query(
            `
            SELECT
                id,
                total,
                payment_status,
                order_status
            FROM orders
            WHERE id = $1
              AND (
                  (
                      $2::uuid IS NOT NULL
                      AND user_id = $2::uuid
                      AND guest_cart_id IS NULL
                  )
                  OR
                  (
                      $3::uuid IS NOT NULL
                      AND guest_cart_id = $3::uuid
                      AND user_id IS NULL
                  )
              )
            FOR UPDATE
            `,
            [orderId, userId, guestCartId]
        );

        if (!orderResult.rowCount) {
            throw new CheckoutAttemptError(
                "Order not found",
                404
            );
        }

        const order = orderResult.rows[0];

        // 2. Only pending orders may start checkout.
        if (
            order.payment_status !== "pending" ||
            order.order_status !== "pending"
        ) {
            throw new CheckoutAttemptError(
                "Order is not eligible for checkout"
            );
        }

        // 3. Recover an existing active attempt.
        const existingResult = await client.query(
            `
            SELECT
                id,
                order_id,
                payment_id,
                idempotency_key,
                stripe_session_id,
                status,
                created_at,
                expires_at
            FROM checkout_attempts
            WHERE order_id = $1
              AND status IN ('creating', 'open')
            FOR UPDATE
            `,
            [order.id]
        );

        if (existingResult.rowCount) {
            await client.query("COMMIT");

            return {
                reused: true,
                attempt: existingResult.rows[0]
            };
        }

        // 4. Refuse an ambiguous previous checkout.
        // Historical attempts require reconciliation before
        // the system can safely start another.
        const historyResult = await client.query(
            `
            SELECT id
            FROM checkout_attempts
            WHERE order_id = $1
            LIMIT 1
            `,
            [order.id]
        );

        if (historyResult.rowCount) {
            throw new CheckoutAttemptError(
                "Previous checkout attempt requires reconciliation"
            );
        }

        // Temporary Checkout expiration policy.
        // Stripe expiration must be coordinated with this value.
        const CHECKOUT_DURATION_MS = 2 * 60 * 60 * 1000;

        const expiration = new Date(
            Date.now() + CHECKOUT_DURATION_MS
        );

        await reserveInventoryForOrder(
            client,
            order.id,
            expiration
        );
        await reserveOrderDelivery(client, order.id, expiration);
        await reserveOrderProduction(client, order.id, expiration);

        // 6. Persist the idempotency key.
        const attemptResult = await client.query(
            `
            INSERT INTO checkout_attempts (
                order_id,
                status,
                expires_at
            )
            VALUES ($1, 'creating', $2)
            RETURNING
                id,
                order_id,
                payment_id,
                idempotency_key,
                stripe_session_id,
                status,
                created_at,
                expires_at
            `,
            [order.id, expiration]
        );

        await client.query("COMMIT");

        return {
            reused: false,
            attempt: attemptResult.rows[0]
        };

    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally {
        client.release();
    }
}


/**
 * Persists an already-created Stripe Checkout Session.
 *
 * IMPORTANT:
 * - Internal service only; never expose directly as a route.
 * - Caller must verify session data with Stripe.
 * - Does not create Stripe sessions or confirm payments.
 * - Does not modify inventory.
 */
export async function attachStripeSessionToAttempt({
    attemptId,
    stripeSessionId,
    expectedTotal = null
}) {
    if (
        typeof attemptId !== "string" ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(attemptId)
    ) {
        throw new CheckoutAttemptError(
            "Invalid checkout attempt ID",
            400
        );
    }

    if (
        typeof stripeSessionId !== "string" ||
        !/^cs_(test|live)_[A-Za-z0-9]+$/.test(stripeSessionId)
    ) {
        throw new CheckoutAttemptError(
            "Invalid Stripe Checkout Session ID",
            400
        );
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Read the order ID without acquiring a row lock.
        const lookup = await client.query(
            `
            SELECT order_id
            FROM checkout_attempts
            WHERE id = $1
            `,
            [attemptId]
        );

        if (!lookup.rowCount) {
            throw new CheckoutAttemptError(
                "Checkout attempt not found",
                404
            );
        }

        // Match the locking order used by preparation:
        // orders first, then checkout_attempts.
        const orderResult = await client.query(
            `
            SELECT id, total, payment_status, order_status
            FROM orders
            WHERE id = $1
            FOR UPDATE
            `,
            [lookup.rows[0].order_id]
        );

        if (!orderResult.rowCount) {
            throw new CheckoutAttemptError(
                "Order not found",
                404
            );
        }

        const order = orderResult.rows[0];

        // Verify that the order total still matches the
        // amount used to create the Stripe session.
        if (expectedTotal !== null) {
            const expected = Number(expectedTotal);
            const actual = Number(order.total);

            if (
                !Number.isFinite(expected) ||
                !Number.isFinite(actual) ||
                Math.round(expected * 100) !==
                Math.round(actual * 100)
            ) {
                throw new CheckoutAttemptError(
                    "Order total changed during Checkout"
                );
            }
        }

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
            [attemptId, order.id]
        );

        if (!attemptResult.rowCount) {
            throw new CheckoutAttemptError(
                "Checkout attempt changed during processing"
            );
        }

        const attempt = attemptResult.rows[0];

        // An existing association must be consistent.
        if (attempt.status === "open") {
            if (
                attempt.stripe_session_id !== stripeSessionId ||
                !attempt.payment_id
            ) {
                throw new CheckoutAttemptError(
                    "Checkout attempt has a conflicting session"
                );
            }

            const paymentResult = await client.query(
                `
                SELECT id, order_id, stripe_payment_id,
                       amount, status
                FROM payments
                WHERE id = $1
                FOR UPDATE
                `,
                [attempt.payment_id]
            );

            const payment = paymentResult.rows[0];

            if (
                !payment ||
                payment.order_id !== order.id ||
                payment.stripe_payment_id !== stripeSessionId ||
                payment.status !== "pending" ||
                Number(payment.amount) !== Number(order.total)
            ) {
                throw new CheckoutAttemptError(
                    "Checkout payment association is inconsistent"
                );
            }

            await client.query("COMMIT");

            return {
                reused: true,
                attemptId: attempt.id,
                paymentId: payment.id,
                stripeSessionId
            };
        }

        if (
            attempt.status !== "creating" ||
            attempt.stripe_session_id !== null ||
            attempt.payment_id !== null
        ) {
            throw new CheckoutAttemptError(
                "Checkout attempt cannot accept a session"
            );
        }

        if (
            order.payment_status !== "pending" ||
            order.order_status !== "pending"
        ) {
            throw new CheckoutAttemptError(
                "Order is no longer eligible for checkout"
            );
        }

        // Only one local pending payment association.
        // Any preexisting payment requires reconciliation.
        const existingPayment = await client.query(
            `
            SELECT id
            FROM payments
            WHERE order_id = $1
            LIMIT 1
            `,
            [order.id]
        );

        if (existingPayment.rowCount) {
            throw new CheckoutAttemptError(
                "Order already has payment history requiring reconciliation"
            );
        }

        const paymentResult = await client.query(
            `
            INSERT INTO payments (
                order_id,
                stripe_payment_id,
                amount,
                status
            )
            VALUES ($1, $2, $3, 'pending')
            RETURNING id
            `,
            [
                order.id,
                stripeSessionId,
                order.total
            ]
        );

        const paymentId = paymentResult.rows[0].id;

        const updated = await client.query(
            `
            UPDATE checkout_attempts
            SET payment_id = $2,
                stripe_session_id = $3,
                status = 'open',
                updated_at = NOW()
            WHERE id = $1
              AND status = 'creating'
            RETURNING id
            `,
            [attempt.id, paymentId, stripeSessionId]
        );

        if (updated.rowCount !== 1) {
            throw new CheckoutAttemptError(
                "Could not transition Checkout attempt to open"
            );
        }

        await client.query("COMMIT");

        return {
            reused: false,
            attemptId: attempt.id,
            paymentId,
            stripeSessionId
        };

    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally {
        client.release();
    }
}


/**
 * Inspects a Checkout attempt to determine the next
 * safe recovery action.
 *
 * IMPORTANT:
 * - Does not contact Stripe.
 * - Does not create or expire sessions.
 * - Does not modify inventory or payments.
 * - Intended for internal backend orchestration.
 *
 * The returned action is a recommendation, not
 * authorization to perform a payment operation.
 */
export async function inspectCheckoutAttempt(attemptId) {
    const UUID_RE =
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

    if (
        typeof attemptId !== "string" ||
        !UUID_RE.test(attemptId)
    ) {
        throw new CheckoutAttemptError(
            "Invalid checkout attempt ID",
            400
        );
    }

    const result = await pool.query(
        `
        SELECT
            id,
            order_id,
            payment_id,
            stripe_session_id,
            status,
            expires_at,
            created_at,
            updated_at
        FROM checkout_attempts
        WHERE id = $1
        `,
        [attemptId]
    );

    if (!result.rowCount) {
        throw new CheckoutAttemptError(
            "Checkout attempt not found",
            404
        );
    }

    const attempt = result.rows[0];

    const expiredLocally =
        attempt.expires_at !== null &&
        new Date(attempt.expires_at).getTime() <= Date.now();

    let action;

    switch (attempt.status) {
        case "creating":
            // Stripe might have created a session even if
            // PostgreSQL never received its identifier.
            action = "reconcile_creation";
            break;

        case "open":
            if (
                !attempt.stripe_session_id ||
                !attempt.payment_id
            ) {
                action = "investigate_inconsistency";
            } else {
                action = "verify_stripe_session";
            }
            break;

        case "completed":
            action = "already_completed";
            break;

        case "expired":
        case "failed":
            action = "terminal_reconciliation";
            break;

        default:
            action = "investigate_inconsistency";
    }

    // Local expiration is not proof that Stripe
    // has stopped accepting payment.
    if (
        expiredLocally &&
        ["creating", "open"].includes(attempt.status)
    ) {
        action = "reconcile_expiration";
    }

    return {
        attemptId: attempt.id,
        orderId: attempt.order_id,
        status: attempt.status,
        action,
        expiredLocally,
        stripeSessionId: attempt.stripe_session_id,
        paymentId: attempt.payment_id
    };
}
