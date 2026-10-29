
import {
    buildStripeCheckoutRequest
} from "./stripeCheckout.service.js";

/**
 * Internal Checkout orchestrator.
 *
 * All dependencies are injected deliberately.
 * This module cannot contact Stripe by itself.
 *
 * Do not expose through an HTTP route yet.
 */
export async function startCheckout(
    {
        orderId,
        userId = null,
        guestCartId = null,
        frontendUrl
    },
    {
        prepare,
        loadOrder,
        attach,
        resume = null,
        stripeClient
    }
) {
    if (
        typeof prepare !== "function" ||
        typeof loadOrder !== "function" ||
        typeof attach !== "function" ||
        typeof stripeClient?.checkout?.sessions?.create
        !== "function"
    ) {
        throw new Error("Invalid Checkout dependencies");
    }

    // Step 1: Reserve stock and persist the attempt.
    const prepared = await prepare({
        orderId,
        userId,
        guestCartId
    });

    const attempt = prepared.attempt;

    if (prepared.reused) {
        // A session already associated with this attempt
        // may be safely resumed after remote verification.
        if (
            attempt.status === "open" &&
            attempt.stripe_session_id &&
            attempt.payment_id
        ) {
            if (typeof resume !== "function") {
                return {
                    status: "reconciliation_required",
                    attemptId: attempt.id
                };
            }

            return resume({
                orderId,
                attemptId: attempt.id,
                stripeClient
            });
        }

        // Never recreate a session for an uncertain
        // or otherwise inconsistent attempt.
        return {
            status: "reconciliation_required",
            attemptId: attempt.id
        };
    }

    // Step 2: Load trusted server-side order data.
    // The real implementation must enforce immutable
    // order totals and ownership before reaching this.
    const order = await loadOrder(orderId);

    if (
        !order ||
        order.id !== orderId ||
        order.payment_status !== "pending" ||
        order.order_status !== "pending"
    ) {
        throw new Error(
            "Order requires reconciliation before Stripe"
        );
    }

    const request = buildStripeCheckoutRequest({
        orderId,
        attemptId: attempt.id,
        total: order.total,
        idempotencyKey: attempt.idempotency_key,
        expiresAt: attempt.expires_at,
        frontendUrl
    });

    // Step 3: Remote operation, outside DB transaction.
    // A failed or ambiguous request remains 'creating'.
    const session =
        await stripeClient.checkout.sessions.create(
            request.params,
            request.requestOptions
        );

    // Step 4: Verify the returned session.
    const expectedAmount =
        request.params.line_items[0]
            .price_data.unit_amount;

    const valid =
        session?.object === "checkout.session" &&
        /^cs_(test|live)_[A-Za-z0-9]+$/.test(
            session.id ?? ""
        ) &&
        session.mode === "payment" &&
        session.status === "open" &&
        session.payment_status === "unpaid" &&
        session.currency === "usd" &&
        session.amount_total === expectedAmount &&
        session.expires_at ===
        request.params.expires_at &&
        session.metadata?.order_id === orderId &&
        session.metadata?.checkout_attempt_id ===
        attempt.id;

    if (!valid) {
        throw new Error(
            "Stripe session verification failed; reconciliation required"
        );
    }

    if (
        typeof session.url !== "string" ||
        !session.url.startsWith(
            "https://checkout.stripe.com/"
        )
    ) {
        throw new Error(
            "Stripe Checkout URL verification failed"
        );
    }

    // Step 5: Persist association atomically.
    const association = await attach({
        attemptId: attempt.id,
        stripeSessionId: session.id,
        expectedTotal: order.total
    });

    return {
        status: "ready",
        attemptId: attempt.id,
        paymentId: association.paymentId,
        checkoutUrl: session.url
    };
}
