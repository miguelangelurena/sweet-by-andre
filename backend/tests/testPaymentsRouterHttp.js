
import test from "node:test";
import assert from "node:assert/strict";

import express from "express";
import request from "supertest";

import {
    createPaymentsRouter
} from "../src/routes/payments.routes.js";

const INVALID_ORDER_ID =
    "not-a-valid-order-id";

test("Checkout router rejects malformed order IDs", async () => {
    let checkoutCalls = 0;

    const app = express();
    app.use(express.json());

    const router = createPaymentsRouter({
        checkoutController: (req, res) => {
            checkoutCalls++;

            return res.status(200).json({
                status: "SUCCESS"
            });
        }
    });

    app.use("/api", router);

    const response = await request(app)
        .post("/api/payments/checkout")
        .send({
            order_id: INVALID_ORDER_ID
        });

    assert.notEqual(response.status, 200);

    assert.equal(
        checkoutCalls,
        0,
        "Unauthorized requests must not reach Checkout"
    );
});

test("Checkout router rejects missing customer identity", async () => {
    let checkoutCalls = 0;

    const app = express();
    app.use(express.json());

    app.use(
        "/api",
        createPaymentsRouter({
            checkoutController: (req, res) => {
                checkoutCalls++;

                return res.status(200).json({
                    status: "SUCCESS"
                });
            }
        })
    );

    const response = await request(app)
        .post("/api/payments/checkout")
        .send({
            order_id:
                "11111111-1111-4111-8111-111111111111"
        });

    assert.notEqual(response.status, 200);
    assert.equal(checkoutCalls, 0);
});
