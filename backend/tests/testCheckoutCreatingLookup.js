
import test from "node:test";
import assert from "node:assert/strict";

import {
    findCreatingCheckoutSession
} from "../src/services/checkoutCreatingLookup.service.js";

const orderId = "order-123";
const attemptId = "attempt-456";

function makeSession(id, metadata = {}) {
    return {
        id,
        object: "checkout.session",
        metadata: {
            order_id: orderId,
            checkout_attempt_id: attemptId,
            ...metadata
        }
    };
}

function makeStripeClient(pages) {
    let calls = 0;

    return {
        checkout: {
            sessions: {
                list: async () => {
                    const page = pages[calls++];

                    assert.ok(page, "Unexpected Stripe request");

                    return page;
                }
            }
        },
        getCalls: () => calls
    };
}

test("finds one matching session", async () => {
    const stripeClient = makeStripeClient([
        {
            data: [
                makeSession("cs_test_other", {
                    order_id: "different"
                }),
                makeSession("cs_test_expected")
            ],
            has_more: false
        }
    ]);

    const result = await findCreatingCheckoutSession({
        stripeClient,
        orderId,
        attemptId
    });

    assert.equal(result.status, "candidate_found");
    assert.equal(result.session.id, "cs_test_expected");
    assert.equal(result.exhausted, true);
    assert.equal(stripeClient.getCalls(), 1);
});

test("reports multiple matching sessions", async () => {
    const stripeClient = makeStripeClient([
        {
            data: [
                makeSession("cs_test_first"),
                makeSession("cs_test_second")
            ],
            has_more: false
        }
    ]);

    const result = await findCreatingCheckoutSession({
        stripeClient,
        orderId,
        attemptId
    });

    assert.equal(result.status, "multiple_matches");
    assert.equal(result.sessions.length, 2);
});

test("reports no matching session", async () => {
    const stripeClient = makeStripeClient([
        {
            data: [
                makeSession("cs_test_other", {
                    order_id: "different"
                })
            ],
            has_more: false
        }
    ]);

    const result = await findCreatingCheckoutSession({
        stripeClient,
        orderId,
        attemptId
    });

    assert.equal(result.status, "not_found");
    assert.equal(result.exhausted, true);
});

test("marks a limited search as incomplete", async () => {
    const stripeClient = makeStripeClient([
        {
            data: [
                makeSession("cs_test_other", {
                    order_id: "different"
                })
            ],
            has_more: true
        }
    ]);

    const result = await findCreatingCheckoutSession({
        stripeClient,
        orderId,
        attemptId,
        maxPages: 1
    });

    assert.equal(result.status, "not_found");
    assert.equal(result.exhausted, false);
});

test("rejects malformed Stripe responses", async () => {
    const stripeClient = makeStripeClient([
        {
            data: null,
            has_more: false
        }
    ]);

    await assert.rejects(
        findCreatingCheckoutSession({
            stripeClient,
            orderId,
            attemptId
        }),
        /Invalid Stripe list response/
    );
});
