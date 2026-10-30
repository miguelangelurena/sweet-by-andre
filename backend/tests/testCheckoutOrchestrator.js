
import test from "node:test";
import assert from "node:assert/strict";

import {
    startCheckout
} from "../src/services/checkoutOrchestrator.service.js";

const orderId =
    "11111111-1111-4111-8111-111111111111";

const attemptId =
    "22222222-2222-4222-8222-222222222222";

const idempotencyKey =
    "33333333-3333-4333-8333-333333333333";

const expiresAt =
    new Date(Date.now() + 2 * 60 * 60 * 1000)
        .toISOString();

function makeDependencies() {
    const calls = {
        stripe: 0,
        attach: 0
    };

    const deps = {
        prepare: async () => ({
            reused: false,
            attempt: {
                id: attemptId,
                idempotency_key: idempotencyKey,
                expires_at: expiresAt
            }
        }),

        loadOrder: async () => ({
            id: orderId,
            total: "18.00",
            payment_status: "pending",
            order_status: "pending"
        }),

        attach: async ({ stripeSessionId }) => {
            calls.attach++;

            assert.equal(
                stripeSessionId,
                "cs_test_mock123456"
            );

            return {
                paymentId: "payment-test-id"
            };
        },

        stripeClient: {
            checkout: {
                sessions: {
                    create: async (params, options) => {
                        calls.stripe++;

                        assert.equal(
                            options.idempotencyKey,
                            `sweetbyandre_checkout_${idempotencyKey}`
                        );

                        return {
                            id: "cs_test_mock123456",
                            object: "checkout.session",
                            mode: "payment",
                            status: "open",
                            payment_status: "unpaid",
                            currency: "usd",
                            amount_total: 1800,
                            expires_at: params.expires_at,
                            metadata: params.metadata,
                            url:
                                "https://checkout.stripe.com/" +
                                "c/pay/mock-session"
                        };
                    }
                }
            }
        }
    };

    return { deps, calls };
}

const input = {
    orderId,
    guestCartId:
        "44444444-4444-4444-8444-444444444444",
    frontendUrl: "http://localhost:5173"
};

test("creates and attaches a validated session", async () => {
    const { deps, calls } = makeDependencies();

    const result = await startCheckout(input, deps);

    assert.equal(result.status, "ready");
    assert.equal(result.attemptId, attemptId);
    assert.equal(result.paymentId, "payment-test-id");
    assert.equal(calls.stripe, 1);
    assert.equal(calls.attach, 1);
});

test("never recreates an existing attempt", async () => {
    const { deps, calls } = makeDependencies();

    deps.prepare = async () => ({
        reused: true,
        attempt: { id: attemptId }
    });

    const result = await startCheckout(input, deps);

    assert.equal(
        result.status,
        "reconciliation_required"
    );

    assert.equal(calls.stripe, 0);
    assert.equal(calls.attach, 0);
});

test("rejects mismatched session amount", async () => {
    const { deps, calls } = makeDependencies();

    deps.stripeClient.checkout.sessions.create =
        async (params) => {
            calls.stripe++;

            return {
                id: "cs_test_mock123456",
                object: "checkout.session",
                mode: "payment",
                status: "open",
                payment_status: "unpaid",
                currency: "usd",
                amount_total: 1900,
                expires_at: params.expires_at,
                metadata: params.metadata,
                url:
                    "https://checkout.stripe.com/" +
                    "c/pay/mock-session"
            };
        };

    await assert.rejects(
        () => startCheckout(input, deps),
        /Stripe session verification failed/
    );

    assert.equal(calls.stripe, 1);
    assert.equal(calls.attach, 0);
});

test("keeps ambiguous Stripe errors unreconciled", async () => {
    const { deps, calls } = makeDependencies();

    deps.stripeClient.checkout.sessions.create =
        async () => {
            calls.stripe++;
            throw new Error("Network connection lost");
        };

    await assert.rejects(
        () => startCheckout(input, deps),
        /Network connection lost/
    );

    assert.equal(calls.stripe, 1);
    assert.equal(calls.attach, 0);
});

test("resumes an existing open Checkout without creating another", async () => {
    const { deps, calls } = makeDependencies();

    let resumeCalls = 0;

    deps.prepare = async () => ({
        reused: true,
        attempt: {
            id: attemptId,
            status: "open",
            stripe_session_id: "cs_test_existing123",
            payment_id: "44444444-4444-4444-8444-444444444444"
        }
    });

    deps.resume = async ({ orderId: receivedOrderId, attemptId: receivedAttemptId }) => {
        resumeCalls++;

        assert.equal(receivedOrderId, orderId);
        assert.equal(receivedAttemptId, attemptId);

        return {
            status: "ready",
            attemptId,
            reused: true,
            checkoutUrl: "https://checkout.stripe.com/c/pay/existing"
        };
    };

    const result = await startCheckout(input, deps);

    assert.equal(result.status, "ready");
    assert.equal(result.reused, true);
    assert.equal(resumeCalls, 1);

    // Crucial: no second Stripe Checkout Session.
    assert.equal(calls.stripe, 0);
    assert.equal(calls.attach, 0);
});

function incompleteAttempt(overrides = {}) {
    return {
        id: attemptId,
        status: "creating",
        stripe_session_id: null,
        payment_id: null,
        idempotency_key: idempotencyKey,
        created_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: expiresAt,
        ...overrides
    };
}

test("recovers a lost creation response using identical Stripe parameters and key", async () => {
    const { deps, calls } = makeDependencies();
    const create = deps.stripeClient.checkout.sessions.create;
    let originalParams;
    let originalOptions;
    let remoteSession;
    let requests = 0;
    deps.stripeClient.checkout.sessions.create = async (params, options) => {
        requests++;
        if (requests === 1) {
            originalParams = structuredClone(params);
            originalOptions = structuredClone(options);
            remoteSession = await create(params, options);
            throw new Error("Response lost after Stripe created the session");
        }
        assert.deepEqual(params, originalParams);
        assert.deepEqual(options, originalOptions);
        return remoteSession;
    };

    await assert.rejects(() => startCheckout(input, deps), /Response lost/);
    assert.equal(calls.attach, 0);
    deps.prepare = async () => ({ reused: true, attempt: incompleteAttempt() });
    const result = await startCheckout(input, deps);
    assert.equal(result.status, "ready");
    assert.equal(requests, 2);
    assert.equal(calls.stripe, 1);
    assert.equal(calls.attach, 1);
});

test("does not replay old, expired, or inconsistent incomplete attempts", async () => {
    const cases = [
        { created_at: undefined },
        { created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
        { created_at: new Date(Date.now() + 60_000).toISOString() },
        { expires_at: new Date(Date.now() - 60_000).toISOString() },
        { expires_at: new Date(Date.now() + 30 * 60_000).toISOString() },
        { stripe_session_id: "cs_test_uncertain" },
        { payment_id: "existing-payment" },
        { status: "failed" },
        { idempotency_key: undefined }
    ];
    for (const overrides of cases) {
        const { deps, calls } = makeDependencies();
        deps.prepare = async () => ({ reused: true, attempt: incompleteAttempt(overrides) });
        const result = await startCheckout(input, deps);
        assert.equal(result.status, "reconciliation_required", JSON.stringify(overrides));
        assert.equal(calls.stripe, 0);
        assert.equal(calls.attach, 0);
    }
});
