
/**
 * Finds possible Stripe sessions for a Checkout attempt.
 *
 * READ-ONLY:
 * - Does not create sessions.
 * - Does not modify PostgreSQL.
 * - Does not release inventory.
 * - Does not associate payments.
 *
 * An incomplete search is never proof that no
 * Stripe session exists.
 */

export async function findCreatingCheckoutSession({
    stripeClient,
    orderId,
    attemptId,
    maxPages = 3
}) {
    if (
        typeof stripeClient?.checkout?.sessions?.list !== "function"
    ) {
        throw new Error("Invalid Stripe client");
    }

    if (!orderId || !attemptId) {
        throw new Error("Checkout identifiers are required");
    }

    if (
        !Number.isInteger(maxPages) ||
        maxPages < 1 ||
        maxPages > 10
    ) {
        throw new Error("Invalid search page limit");
    }

    const matches = [];
    let startingAfter;
    let exhausted = false;

    for (let page = 0; page < maxPages; page++) {
        const params = {
            limit: 100
        };

        if (startingAfter) {
            params.starting_after = startingAfter;
        }

        const result =
            await stripeClient.checkout.sessions.list(params);

        if (
            !Array.isArray(result?.data) ||
            typeof result.has_more !== "boolean"
        ) {
            throw new Error("Invalid Stripe list response");
        }

        for (const session of result.data) {
            if (
                session?.metadata?.order_id === orderId &&
                session?.metadata?.checkout_attempt_id ===
                attemptId
            ) {
                matches.push(session);
            }
        }

        if (!result.has_more) {
            exhausted = true;
            break;
        }

        const last = result.data.at(-1);

        if (!last?.id || last.id === startingAfter) {
            throw new Error("Invalid Stripe pagination");
        }

        startingAfter = last.id;
    }

    if (matches.length > 1) {
        return {
            status: "multiple_matches",
            sessions: matches,
            exhausted
        };
    }

    if (matches.length === 1) {
        return {
            status: "candidate_found",
            session: matches[0],
            exhausted
        };
    }

    return {
        status: "not_found",
        exhausted
    };
}
