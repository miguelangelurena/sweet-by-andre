
/**
 * Validates an existing Stripe Checkout Session
 * before allowing a customer to resume payment.
 *
 * This service:
 * - Does not modify PostgreSQL.
 * - Does not create Stripe sessions.
 * - Does not modify payments or inventory.
 */

function amountToCents(value) {
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
 * Verifies whether an existing Stripe Checkout
 * Session can safely be reused.
 *
 * Caller must enforce order ownership.
 */
export async function resumeOpenCheckoutSession({
    order,
    attempt,
    payment,
    stripeClient,
    now = new Date()
}) {
    // 1. Validate the local association.
    if (
        !order ||
        !attempt ||
        !payment ||
        attempt.order_id !== order.id ||
        payment.order_id !== order.id ||
        attempt.payment_id !== payment.id ||
        attempt.status !== "open" ||
        payment.status !== "pending" ||
        order.payment_status !== "pending" ||
        order.order_status !== "pending" ||
        !attempt.stripe_session_id ||
        payment.stripe_payment_id !==
        attempt.stripe_session_id
    ) {
        return {
            status: "reconciliation_required"
        };
    }

    // 2. Require a Stripe client capable
    // of retrieving Checkout sessions.
    if (
        typeof stripeClient?.checkout?.sessions?.retrieve !==
        "function"
    ) {
        throw new Error("Invalid Stripe client");
    }

    // 3. Retrieve the existing session from Stripe.
    // Never create a new session here.
    const session =
        await stripeClient.checkout.sessions.retrieve(
            attempt.stripe_session_id
        );

    const expectedAmount = amountToCents(order.total);

    const expectedExpiration = Math.floor(
        new Date(attempt.expires_at).getTime() / 1000
    );

    const currentTime = Math.floor(
        new Date(now).getTime() / 1000
    );

    // 4. Validate the Checkout URL.
    const validUrl = (() => {
        try {
            const url = new URL(session?.url);

            return (
                url.protocol === "https:" &&
                url.hostname === "checkout.stripe.com" &&
                !url.username &&
                !url.password
            );
        } catch {
            return false;
        }
    })();

    // 5. Verify the Stripe session against
    // the original order and checkout attempt.
    const valid =
        session?.id === attempt.stripe_session_id &&
        session?.object === "checkout.session" &&
        session?.mode === "payment" &&
        session?.status === "open" &&
        session?.payment_status === "unpaid" &&
        session?.currency?.toLowerCase() === "usd" &&
        session?.amount_total === expectedAmount &&
        session?.metadata?.order_id === order.id &&
        session?.metadata?.checkout_attempt_id ===
        attempt.id &&
        Number.isSafeInteger(expectedExpiration) &&
        session?.expires_at === expectedExpiration &&
        session.expires_at > currentTime &&
        validUrl;

    if (!valid) {
        return {
            status: "reconciliation_required"
        };
    }

    // 6. Existing session can be resumed.
    return {
        status: "ready",
        attemptId: attempt.id,
        checkoutUrl: session.url,
        reused: true
    };
}
