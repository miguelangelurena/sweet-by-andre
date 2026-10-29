
import { pool } from "../config/database.js";

import {
    attachStripeSessionToAttempt
} from "./checkoutAttempt.service.js";

const UUID_RE =
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function toCents(value) {
    const amount = String(value);

    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
        throw new Error("Invalid stored order amount");
    }

    const [whole, fraction = ""] = amount.split(".");

    const cents =
        Number(whole) * 100 +
        Number(fraction.padEnd(2, "0"));

    if (!Number.isSafeInteger(cents) || cents <= 0) {
        throw new Error("Invalid stored order amount");
    }

    return cents;
}

/**
 * Recovers a missing local association using an
 * authenticated, paid Stripe Checkout Session.
 *
 * Does not confirm payment or deduct inventory.
 *
 * Never expose directly as an HTTP endpoint.
 */
export async function recoverPaidCheckoutAssociation(session) {
    const orderId = session?.metadata?.order_id;
    const attemptId =
        session?.metadata?.checkout_attempt_id;

    if (
        session?.object !== "checkout.session" ||
        session?.mode !== "payment" ||
        session?.status !== "complete" ||
        session?.payment_status !== "paid" ||
        session?.currency?.toLowerCase() !== "usd" ||
        !Number.isSafeInteger(session?.amount_total) ||
        session.amount_total <= 0 ||
        typeof session?.id !== "string" ||
        !/^cs_(test|live)_[A-Za-z0-9]+$/.test(session.id) ||
        !UUID_RE.test(orderId ?? "") ||
        !UUID_RE.test(attemptId ?? "")
    ) {
        throw new Error(
            "Invalid paid Checkout session for recovery"
        );
    }

    // This is a preliminary read.
    // The attachment service will recheck under locks.
    const result = await pool.query(
        `
        SELECT
            a.id,
            a.status,
            a.payment_id,
            a.stripe_session_id,
            o.id AS order_id,
            o.total
        FROM checkout_attempts a
        JOIN orders o ON o.id = a.order_id
        WHERE a.id = $1
          AND a.order_id = $2
        `,
        [attemptId, orderId]
    );

    if (result.rowCount !== 1) {
        throw new Error(
            "Checkout attempt not found; reconciliation required"
        );
    }

    const attempt = result.rows[0];

    if (toCents(attempt.total) !== session.amount_total) {
        throw new Error(
            "Stripe session amount does not match order"
        );
    }

    // A successfully associated session needs no recovery.
    // The confirmation service will verify its payment.
    if (
        ["open", "completed"].includes(attempt.status)
    ) {
        if (
            attempt.stripe_session_id !== session.id ||
            !attempt.payment_id
        ) {
            throw new Error(
                "Existing Checkout association is inconsistent"
            );
        }

        return {
            status: "already_associated",
            attemptId
        };
    }

    // An attempt in a terminal or unexpected state
    // must not be reopened automatically.
    if (attempt.status !== "creating") {
        throw new Error(
            "Checkout attempt requires manual reconciliation"
        );
    }

    if (
        attempt.stripe_session_id !== null ||
        attempt.payment_id !== null
    ) {
        throw new Error(
            "Creating attempt has inconsistent associations"
        );
    }

    // This operation rechecks state while holding
    // the appropriate PostgreSQL row locks.
    const association = await attachStripeSessionToAttempt({
        attemptId,
        stripeSessionId: session.id,
        expectedTotal: attempt.total
    });

    return {
        status: association.reused
            ? "already_associated"
            : "recovered",
        attemptId
    };
}
