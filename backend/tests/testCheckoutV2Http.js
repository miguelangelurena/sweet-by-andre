
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

import {
    makeCheckoutV2Controller
} from "../src/controllers/checkoutV2.controllers.js";

const ORDER_ID =
    "11111111-1111-4111-8111-111111111111";

const CART_ID =
    "22222222-2222-4222-8222-222222222222";

function createApp({
    authorized = true,
    identity = "guest",
    result = {
        status: "ready",
        checkoutUrl:
            "https://checkout.stripe.com/c/pay/mock"
    },
    startCheckout
} = {}) {
    const app = express();

    app.use(express.json());

    app.post(
        "/api/payments/checkout",
        (req, res, next) => {
            if (authorized) {
                req.checkoutOrder = { id: ORDER_ID };
            }

            if (identity === "guest") {
                req.cartId = CART_ID;
            } else if (identity === "user") {
                req.user = { id: CART_ID };
            } else if (identity === "both") {
                req.user = { id: CART_ID };
                req.cartId = CART_ID;
            }

            next();
        },
        makeCheckoutV2Controller({
            startCheckout:
                startCheckout ?? (async () => result),
            stripeClient: {}
        })
    );

    return app;
}

test("rejects unauthorized orders", async () => {
    const response = await request(
        createApp({ authorized: false })
    ).post("/api/payments/checkout");

    assert.equal(response.status, 403);
});

test("rejects invalid Checkout identity", async () => {
    const response = await request(
        createApp({ identity: "both" })
    ).post("/api/payments/checkout");

    assert.equal(response.status, 401);
});

test("returns 409 for reconciliation", async () => {
    const response = await request(
        createApp({
            result: {
                status: "reconciliation_required",
                attemptId: ORDER_ID
            }
        })
    ).post("/api/payments/checkout");

    assert.equal(response.status, 409);
    assert.equal(
        response.body.status,
        "RECONCILIATION_REQUIRED"
    );
});

test("returns Checkout URL for a ready session", async () => {
    let receivedInput = null;

    const response = await request(
        createApp({
            startCheckout: async input => {
                receivedInput = input;

                return {
                    status: "ready",
                    checkoutUrl:
                        "https://checkout.stripe.com/c/pay/mock"
                };
            }
        })
    ).post("/api/payments/checkout");

    assert.equal(response.status, 200);
    assert.equal(response.body.status, "SUCCESS");
    assert.ok(
        response.body.checkoutUrl.startsWith(
            "https://checkout.stripe.com/"
        )
    );

    assert.equal(receivedInput.orderId, ORDER_ID);
    assert.equal(receivedInput.guestCartId, CART_ID);
    assert.equal(receivedInput.userId, null);
});

test("returns 500 for unexpected Checkout failures", async () => {
    const response = await request(
        createApp({
            startCheckout: async () => {
                throw new Error("Simulated Stripe failure");
            }
        })
    ).post("/api/payments/checkout");

    assert.equal(response.status, 500);
    assert.equal(
        response.body.message,
        "Could not initialize Checkout"
    );
});
