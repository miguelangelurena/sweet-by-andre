
import test from "node:test";
import assert from "node:assert/strict";

import {
    buildStripeCheckoutRequest
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
        first.params.payment_method_types[0],
        "card"
    );

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
