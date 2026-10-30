
import test from "node:test";
import assert from "node:assert/strict";

import {
    buildStripeCheckoutRequest,
    createStripeCheckoutSession
} from "../src/services/stripeCheckout.service.js";

const input = {
    orderId: "8f0fa4dc-ca68-4b65-bfcf-dee2dd6a5352",
    attemptId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    total: "18.00",
    frontendUrl: "http://localhost:5173",
    now: new Date("2026-10-26T18:00:00Z"),
    expiresAt: "2026-10-26T20:00:00Z"
};

function stripeError(type, extra = {}) {
    return Object.assign(new Error("Stripe request failed"), { type, ...extra });
}

test("migrates only a proven legacy parameter rejection with a deterministic key", async () => {
    const request = buildStripeCheckoutRequest(input);
    const rejection = stripeError("StripeInvalidRequestError", {
        statusCode: 400, param: "payment_method_types",
        message: "The payment_method_types parameter is no longer supported"
    });
    const migratedSessions = new Map();
    let created = 0;
    const stripeClient = { checkout: { sessions: { create: async (params, options) => {
        if (options.idempotencyKey === request.requestOptions.idempotencyKey) {
            if (Object.hasOwn(params, "allowed_payment_method_types")) {
                throw stripeError("StripeIdempotencyError");
            }
            assert.deepEqual(params.payment_method_types, ["card"]);
            throw rejection;
        }
        assert.equal(options.idempotencyKey, `${request.requestOptions.idempotencyKey}_allowed_cards_v1`);
        assert.deepEqual(params, request.params);
        if (!migratedSessions.has(options.idempotencyKey)) {
            created++;
            migratedSessions.set(options.idempotencyKey, { id: "cs_test_recovered" });
        }
        return migratedSessions.get(options.idempotencyKey);
    } } } };
    const first = await createStripeCheckoutSession(stripeClient, request);
    const second = await createStripeCheckoutSession(stripeClient, request);
    assert.deepEqual(first, second);
    assert.equal(created, 1);
});

test("does not migrate uncertain or unrelated legacy outcomes", async () => {
    for (const outcome of [
        stripeError("StripeConnectionError"),
        stripeError("StripeIdempotencyError"),
        stripeError("StripeInvalidRequestError", { statusCode: 400, param: "currency" }),
        stripeError("StripeInvalidRequestError", {
            statusCode: 500, param: "payment_method_types", message: "no longer supported"
        }),
        { id: "cs_test_existing" }
    ]) {
        let calls = 0;
        const stripeClient = { checkout: { sessions: { create: async () => {
            calls++;
            if (calls === 1) throw stripeError("StripeIdempotencyError");
            if (outcome instanceof Error) throw outcome;
            return outcome;
        } } } };
        await assert.rejects(() => createStripeCheckoutSession(stripeClient, buildStripeCheckoutRequest(input)));
        assert.equal(calls, 2);
    }
});

test("never changes the key on an initial connection failure", async () => {
    let calls = 0;
    const stripeClient = { checkout: { sessions: { create: async () => {
        calls++;
        throw stripeError("StripeConnectionError");
    } } } };
    await assert.rejects(() => createStripeCheckoutSession(stripeClient, buildStripeCheckoutRequest(input)));
    assert.equal(calls, 1);
});

test("builds a deterministic Checkout request", () => {
    const first = buildStripeCheckoutRequest(input);
    const second = buildStripeCheckoutRequest(input);

    assert.deepEqual(first, second);

    assert.equal(
        first.params.line_items[0].price_data.unit_amount,
        1800
    );

    assert.equal(
        first.params.line_items[0].price_data.currency,
        "usd"
    );

    assert.equal(
        first.params.metadata.order_id,
        input.orderId
    );

    assert.equal(
        first.params.metadata.checkout_attempt_id,
        input.attemptId
    );

    assert.equal(
        first.params.expires_at,
        Math.floor(
            new Date(input.expiresAt).getTime() / 1000
        )
    );

    assert.equal(
        first.params.allowed_payment_method_types[0],
        "card"
    );
    assert.equal(Object.hasOwn(first.params, "payment_method_types"), false);

    assert.equal(
        first.requestOptions.idempotencyKey,
        `sweetbyandre_checkout_${input.idempotencyKey}`
    );
});

test("rejects invalid monetary values", () => {
    for (const total of [
        "0.00",
        "-5.00",
        "18.999",
        "invalid"
    ]) {
        assert.throws(
            () => buildStripeCheckoutRequest({
                ...input,
                total
            }),
            /Invalid checkout amount/
        );
    }
});

test("rejects checkout expiration too close", () => {
    assert.throws(
        () => buildStripeCheckoutRequest({
            ...input,
            expiresAt: "2026-10-26T18:15:00Z"
        }),
        /requires reconciliation/
    );
});

test("rejects invalid frontend origins", () => {
    assert.throws(
        () => buildStripeCheckoutRequest({
            ...input,
            frontendUrl: "http://untrusted.example.com"
        }),
        /Invalid frontend origin/
    );
});
