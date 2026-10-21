
import { test } from "node:test";
import assert from "node:assert/strict";
import { processRefund } from "../src/services/refund.service.js";

test("processRefund completes a successful refund", async () => {
    const queries = [];
    let committed = false;

    const fakeClient = {
        async query(sql, params = []) {
            queries.push({ sql, params });

            if (sql.includes("SELECT") &&
                sql.includes("FROM refund_requests")) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: "refund-request-1",
                        order_id: "order-1",
                        payment_id: "payment-1",
                        idempotency_key: "order-refund-order-1",
                        status: "pending",
                        stripe_refund_id: null,
                        stripe_payment_intent_id: "pi_test_123",
                        total: "50.00"
                    }]
                };
            }

            if (sql.includes("UPDATE")) {
                return { rowCount: 1, rows: [] };
            }

            if (sql === "COMMIT") {
                committed = true;
            }

            return { rowCount: 0, rows: [] };
        },
        release() { }
    };

    const fakeDatabase = {
        async connect() {
            return fakeClient;
        }
    };

    const fakeStripe = {
        paymentIntents: {
            async retrieve() {
                return {
                    id: "pi_test_123",
                    status: "succeeded",
                    currency: "usd",
                    amount_received: 5000
                };
            }
        },
        refunds: {
            async list() {
                return {
                    data: [],
                    has_more: false
                };
            },
            async create() {
                return {
                    id: "re_test_123",
                    status: "succeeded",
                    payment_intent: "pi_test_123",
                    amount: 5000,
                    currency: "usd"
                };
            }
        }
    };

    const result = await processRefund(
        "refund-request-1",
        {
            database: fakeDatabase,
            stripeClient: fakeStripe
        }
    );

    assert.equal(result.status, "succeeded");
    assert.equal(result.refundId, "re_test_123");
    assert.equal(committed, true);

    assert.ok(
        queries.some(({ sql }) =>
            sql.includes("UPDATE refund_requests")
        )
    );

    assert.ok(
        queries.some(({ sql }) =>
            sql.includes("UPDATE payments")
        )
    );

    assert.ok(
        queries.some(({ sql }) =>
            sql.includes("UPDATE orders")
        )
    );
});


test("processRefund rejects a payment amount mismatch", async () => {
    let refundCreated = false;
    let rolledBack = false;

    const fakeClient = {
        async query(sql) {
            if (sql.includes("FROM refund_requests")) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: "refund-request-2",
                        order_id: "order-2",
                        payment_id: "payment-2",
                        idempotency_key: "order-refund-order-2",
                        status: "pending",
                        stripe_refund_id: null,
                        stripe_payment_intent_id: "pi_test_456",
                        total: "50.00"
                    }]
                };
            }

            if (sql === "ROLLBACK") {
                rolledBack = true;
            }

            return { rowCount: 0, rows: [] };
        },
        release() { }
    };

    const fakeStripe = {
        paymentIntents: {
            async retrieve() {
                return {
                    status: "succeeded",
                    currency: "usd",
                    amount_received: 4000
                };
            }
        },
        refunds: {
            async create() {
                refundCreated = true;
                throw new Error("Refund should not be created");
            }
        }
    };

    await assert.rejects(
        () => processRefund("refund-request-2", {
            database: {
                async connect() {
                    return fakeClient;
                }
            },
            stripeClient: fakeStripe
        }),
        /Payment amount or currency mismatch/
    );

    assert.equal(refundCreated, false);
    assert.equal(rolledBack, true);
});


test("processRefund reuses an existing Stripe refund", async () => {
    let refundCreated = false;
    const queries = [];

    const fakeClient = {
        async query(sql) {
            queries.push(sql);

            if (sql.includes("FROM refund_requests")) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: "refund-request-3",
                        order_id: "order-3",
                        payment_id: "payment-3",
                        idempotency_key: "order-refund-order-3",
                        status: "processing",
                        stripe_refund_id: null,
                        stripe_payment_intent_id: "pi_test_789",
                        total: "50.00"
                    }]
                };
            }

            return { rowCount: 1, rows: [] };
        },
        release() { }
    };

    const fakeStripe = {
        paymentIntents: {
            async retrieve() {
                return {
                    status: "succeeded",
                    currency: "usd",
                    amount_received: 5000
                };
            }
        },
        refunds: {
            async list() {
                return {
                    data: [{
                        id: "re_existing_123",
                        status: "succeeded",
                        payment_intent: "pi_test_789",
                        amount: 5000,
                        currency: "usd",
                        metadata: {
                            refund_request_id: "refund-request-3"
                        }
                    }],
                    has_more: false
                };
            },
            async create() {
                refundCreated = true;
                throw new Error("Duplicate refund attempted");
            }
        }
    };

    const result = await processRefund(
        "refund-request-3",
        {
            database: {
                async connect() {
                    return fakeClient;
                }
            },
            stripeClient: fakeStripe
        }
    );

    assert.equal(result.status, "succeeded");
    assert.equal(result.refundId, "re_existing_123");
    assert.equal(refundCreated, false);

    assert.ok(
        queries.some((sql) =>
            sql.includes("UPDATE refund_requests")
        )
    );

    assert.ok(
        queries.some((sql) =>
            sql.includes("UPDATE payments")
        )
    );

    assert.ok(
        queries.some((sql) =>
            sql.includes("UPDATE orders")
        )
    );
});
