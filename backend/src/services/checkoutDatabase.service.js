
import { pool } from "../config/database.js";

import {
    prepareCheckoutAttempt,
    attachStripeSessionToAttempt
} from "./checkoutAttempt.service.js";

import {
    startCheckout
} from "./checkoutOrchestrator.service.js";

import {
    resumeOpenCheckoutSession
} from "./checkoutSessionResume.service.js";

/**
 * Database integration for Checkout.
 *
 * Internal services only.
 * Public routes must enforce ownership and CSRF.
 */

// ==========================================
// LOAD CHECKOUT ORDER
// ==========================================

export async function loadCheckoutOrder(orderId) {
    const result = await pool.query(
        `
        SELECT
            id,
            total,
            payment_status,
            order_status
        FROM orders
        WHERE id = $1
        `,
        [orderId]
    );

    return result.rows[0] ?? null;
}

// ==========================================
// CREATE CHECKOUT DEPENDENCIES
// ==========================================

export function createDatabaseCheckoutDependencies(
    stripeClient
) {
    return {
        prepare: prepareCheckoutAttempt,
        loadOrder: loadCheckoutOrder,
        attach: attachStripeSessionToAttempt,
        resume: resumeDatabaseCheckout,
        stripeClient
    };
}

// ==========================================
// START DATABASE CHECKOUT
// ==========================================

export async function startDatabaseCheckout(
    {
        orderId,
        userId = null,
        guestCartId = null,
        frontendUrl
    },
    stripeClient
) {
    const dependencies =
        createDatabaseCheckoutDependencies(
            stripeClient
        );

    return startCheckout(
        {
            orderId,
            userId,
            guestCartId,
            frontendUrl
        },
        dependencies
    );
}

// ==========================================
// RESUME EXISTING DATABASE CHECKOUT
// ==========================================

/**
 * Retrieves an existing Checkout session.
 *
 * Steps:
 * 1. Read the current local association.
 * 2. Verify the Stripe session remotely.
 * 3. Recheck PostgreSQL state under row locks.
 * 4. Return the URL only when still consistent.
 *
 * Does not create Stripe sessions or payments.
 *
 * Ownership must be checked by the caller.
 */
export async function resumeDatabaseCheckout({
    orderId,
    attemptId,
    stripeClient
}) {
    // 1. Load current Checkout association.
    const initial = await pool.query(
        `
        SELECT
            o.id,
            o.total,
            o.payment_status,
            o.order_status,

            a.id AS attempt_id,
            a.order_id AS attempt_order_id,
            a.payment_id,
            a.stripe_session_id,
            a.status AS attempt_status,
            a.expires_at,

            p.id AS local_payment_id,
            p.order_id AS payment_order_id,
            p.stripe_payment_id,
            p.status AS payment_status_local

        FROM orders o

        JOIN checkout_attempts a
            ON a.order_id = o.id

        LEFT JOIN payments p
            ON p.id = a.payment_id

        WHERE o.id = $1
          AND a.id = $2
        `,
        [orderId, attemptId]
    );

    if (initial.rowCount !== 1) {
        return {
            status: "reconciliation_required"
        };
    }

    const row = initial.rows[0];

    // 2. Verify the existing session with Stripe.
    // No database transaction remains open during
    // this external network request.
    const result = await resumeOpenCheckoutSession({
        order: {
            id: row.id,
            total: row.total,
            payment_status: row.payment_status,
            order_status: row.order_status
        },

        attempt: {
            id: row.attempt_id,
            order_id: row.attempt_order_id,
            payment_id: row.payment_id,
            stripe_session_id: row.stripe_session_id,
            status: row.attempt_status,
            expires_at: row.expires_at
        },

        payment: {
            id: row.local_payment_id,
            order_id: row.payment_order_id,
            stripe_payment_id: row.stripe_payment_id,
            status: row.payment_status_local
        },

        stripeClient
    });

    if (result.status !== "ready") {
        return {
            status: "reconciliation_required"
        };
    }

    // 3. Recheck the local state after querying Stripe.
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Lock order first.
        const orderCheck = await client.query(
            `
            SELECT
                id,
                total,
                payment_status,
                order_status
            FROM orders
            WHERE id = $1
            FOR UPDATE
            `,
            [orderId]
        );

        // Lock checkout attempt second.
        const attemptCheck = await client.query(
            `
            SELECT
                id,
                payment_id,
                stripe_session_id,
                status,
                expires_at
            FROM checkout_attempts
            WHERE id = $1
              AND order_id = $2
            FOR UPDATE
            `,
            [attemptId, orderId]
        );

        let valid = false;

        if (
            orderCheck.rowCount === 1 &&
            attemptCheck.rowCount === 1
        ) {
            const order = orderCheck.rows[0];
            const attempt = attemptCheck.rows[0];

            // Lock payment third.
            const paymentCheck = await client.query(
                `
                SELECT
                    id,
                    order_id,
                    stripe_payment_id,
                    status
                FROM payments
                WHERE id = $1
                FOR UPDATE
                `,
                [attempt.payment_id]
            );

            valid =
                order.payment_status === "pending" &&
                order.order_status === "pending" &&

                // Numeric totals may be returned as strings.
                String(order.total) === String(row.total) &&

                attempt.status === "open" &&

                attempt.payment_id === row.payment_id &&

                attempt.stripe_session_id ===
                row.stripe_session_id &&

                new Date(attempt.expires_at).getTime() >
                Date.now() &&

                paymentCheck.rowCount === 1 &&

                paymentCheck.rows[0].id ===
                row.local_payment_id &&

                paymentCheck.rows[0].order_id === orderId &&

                paymentCheck.rows[0].status === "pending" &&

                paymentCheck.rows[0].stripe_payment_id ===
                row.stripe_session_id;
        }

        await client.query("COMMIT");

        if (!valid) {
            return {
                status: "reconciliation_required"
            };
        }

        return result;

    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;

    } finally {
        client.release();
    }
}
