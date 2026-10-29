
import test from "node:test";
import assert from "node:assert/strict";

import {
    resumeOpenCheckoutSession
} from "../src/services/checkoutSessionResume.service.js";

const orderId =
    "11111111-1111-4111-8111-111111111111";

const attemptId =
    "22222222-2222-4222-8222-222222222222";

const paymentId =
    "33333333-3333-4333-8333-333333333333";

const sessionId = "cs_test_resume123456";

const expiresAt = "2026-10-27T18:00:00.000Z";
const now = new Date("2026-10-27T16:00:00.000Z");

function createFixture(overrides = {}) {
    const order = {
        id: orderId,
        total: "18.00",
        payment_status: "pending",
        order_status: "pending"
    };

    const attempt = {
        id: attemptId,
        order_id: orderId,
        payment_id: paymentId,
        stripe_session_id: sessionId,
        status: "open",
        expires_at: expiresAt
    };

    const payment = {
        id: paymentId,
        order_id: orderId,
        stripe_payment_id: sessionId,
        status: "pending"
    };

    const session = {
        id: sessionId,
        object: "checkout.session",
        mode: "payment",
        status: "open",
        payment_status: "unpaid",
        currency: "usd",
        amount_total: 1800,
        expires_at:
            Math.floor(new Date(expiresAt).getTime() / 1000),
        metadata: {
            order_id: orderId,
            checkout_attempt_id: attemptId
        },
        url: "https://checkout.stripe.com/c/pay/mock"
    };

    let retrieveCount = 0;

    const stripeClient = {
        checkout: {
            sessions: {
                retrieve: async id => {
                    retrieveCount++;
                    assert.equal(id, sessionId);

                    return {
                        ...session,
                        ...overrides.session
                    };
                }
            }
        }
    };

    return {
        order: { ...order, ...overrides.order },
        attempt: { ...attempt, ...overrides.attempt },
        payment: { ...payment, ...overrides.payment },
        stripeClient,
        now,
        getRetrieveCount: () => retrieveCount
    };
}

test("resumes a valid open Checkout", async () => {
    const input = createFixture();

    const result = await resumeOpenCheckoutSession(input);

    assert.equal(result.status, "ready");
    assert.equal(result.reused, true);
    assert.equal(result.attemptId, attemptId);
    assert.equal(
        result.checkoutUrl,
        "https://checkout.stripe.com/c/pay/mock"
    );
    assert.equal(input.getRetrieveCount(), 1);
});

test("rejects a completed Stripe session", async () => {
    const input = createFixture({
        session: {
            status: "complete",
            payment_status: "paid"
        }
    });

    const result = await resumeOpenCheckoutSession(input);

    assert.equal(
        result.status,
        "reconciliation_required"
    );
});

test("rejects a mismatched amount", async () => {
    const input = createFixture({
        session: { amount_total: 1900 }
    });

    const result = await resumeOpenCheckoutSession(input);

    assert.equal(
        result.status,
        "reconciliation_required"
    );
});

test("rejects an expired session", async () => {
    const input = createFixture({
        session: { status: "expired" }
    });

    const result = await resumeOpenCheckoutSession(input);

    assert.equal(
        result.status,
        "reconciliation_required"
    );
});

test("rejects a mismatched Checkout attempt", async () => {
    const input = createFixture({
        session: {
            metadata: {
                order_id: orderId,
                checkout_attempt_id:
                    "44444444-4444-4444-8444-444444444444"
            }
        }
    });

    const result = await resumeOpenCheckoutSession(input);

    assert.equal(
        result.status,
        "reconciliation_required"
    );
});

test("rejects an inconsistent local payment", async () => {
    const input = createFixture({
        payment: {
            stripe_payment_id: "cs_test_different"
        }
    });

    const result = await resumeOpenCheckoutSession(input);

    assert.equal(
        result.status,
        "reconciliation_required"
    );

    assert.equal(input.getRetrieveCount(), 0);
});

test("rejects an unexpected Checkout URL", async () => {
    const input = createFixture({
        session: {
            url: "https://example.com/fake-checkout"
        }
    });

    const result = await resumeOpenCheckoutSession(input);

    assert.equal(
        result.status,
        "reconciliation_required"
    );
});
