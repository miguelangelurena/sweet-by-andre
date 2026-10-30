
/**
 * Builds deterministic Stripe Checkout parameters.
 *
 * No Stripe API calls.
 * No database queries.
 * No inventory modifications.
 */

const UUID_RE =
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Recover requests rejected by the removed payment_method_types parameter.
 * Never change keys for a timeout or an ambiguous creation result.
 */
export async function createStripeCheckoutSession(stripeClient, request) {
    const create = (params, options) =>
        stripeClient.checkout.sessions.create(params, options);

    try {
        return await create(request.params, request.requestOptions);
    } catch (error) {
        if (error.type !== "StripeIdempotencyError") throw error;

        // Reconstruct the previous request under its original key. A cached
        // parameter rejection proves that request did not create a session.
        const { allowed_payment_method_types, ...legacyParams } = request.params;
        legacyParams.payment_method_types = allowed_payment_method_types;
        try {
            await create(legacyParams, request.requestOptions);
        } catch (legacyError) {
            if (
                legacyError.type !== "StripeInvalidRequestError" ||
                legacyError.statusCode !== 400 ||
                legacyError.param !== "payment_method_types" ||
                !legacyError.message?.includes("no longer supported")
            ) throw legacyError;

            // A deterministic suffix keeps migration retries idempotent too.
            return create(request.params, {
                ...request.requestOptions,
                idempotencyKey:
                    `${request.requestOptions.idempotencyKey}_allowed_cards_v1`
            });
        }
        // A successful legacy response is not proof of rejection. Stop rather
        // than starting another session with a different key.
        throw error;
    }
}

function toCents(amount) {
    const value = String(amount);

    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
        throw new Error("Invalid checkout amount");
    }

    const [whole, fraction = ""] = value.split(".");

    const cents =
        Number(whole) * 100 +
        Number(fraction.padEnd(2, "0"));

    if (!Number.isSafeInteger(cents) || cents <= 0) {
        throw new Error("Invalid checkout amount");
    }

    return cents;
}

export function buildStripeCheckoutRequest({
    orderId,
    attemptId,
    total,
    idempotencyKey,
    expiresAt,
    frontendUrl,
    now = new Date()
}) {
    if (
        !UUID_RE.test(orderId ?? "") ||
        !UUID_RE.test(attemptId ?? "") ||
        !UUID_RE.test(idempotencyKey ?? "")
    ) {
        throw new Error("Invalid checkout identifiers");
    }

    const amountInCents = toCents(total);

    const expiration = new Date(expiresAt);
    const currentTime = new Date(now);

    if (
        Number.isNaN(expiration.getTime()) ||
        Number.isNaN(currentTime.getTime())
    ) {
        throw new Error("Invalid checkout expiration");
    }

    const remainingMs =
        expiration.getTime() - currentTime.getTime();

    // Keep a margin above Stripe's minimum expiration.
    if (
        remainingMs < 31 * 60 * 1000 ||
        remainingMs > 24 * 60 * 60 * 1000
    ) {
        throw new Error(
            "Checkout expiration requires reconciliation"
        );
    }

    let origin;

    try {
        const url = new URL(frontendUrl);

        const isLocal =
            url.protocol === "http:" &&
            url.hostname === "localhost";

        const isHttps = url.protocol === "https:";

        if (
            (!isLocal && !isHttps) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            url.pathname !== "/"
        ) {
            throw new Error("Invalid frontend origin");
        }

        origin = url.origin;
    } catch {
        throw new Error("Invalid frontend origin");
    }

    return {
        params: {
            mode: "payment",
            allowed_payment_method_types: ["card"],

            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: `Sweet by Andre order ${orderId}`
                        },
                        unit_amount: amountInCents
                    },
                    quantity: 1
                }
            ],

            metadata: {
                order_id: orderId,
                checkout_attempt_id: attemptId
            },

            expires_at: Math.floor(
                expiration.getTime() / 1000
            ),

            success_url:
                `${origin}/payment-success` +
                "?session_id={CHECKOUT_SESSION_ID}",

            cancel_url:
                `${origin}/payment-cancelled`
        },

        requestOptions: {
            idempotencyKey:
                `sweetbyandre_checkout_${idempotencyKey}`
        }
    };
}
