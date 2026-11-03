import test from "node:test";
import assert from "node:assert/strict";
import { processRefund } from "../src/services/refund.service.js";
import { adminRefundsEnabled, refundAmountCents } from "../src/services/orderRefund.service.js";

function fixture() {
  const rr = { id: "request-1", order_id: "order-1", payment_id: "payment-1",
    total: "50.00", status: "pending", idempotency_key: "durable-key", stripe_payment_intent_id: "pi_test_1" };
  let released = false;
  const created = [];
  const database = { connect: async () => ({
    query: async () => ({ rows: [rr] }), release: () => { released = true; }
  }) };
  const refund = { id: "re_test_1", status: "succeeded", amount: 5000,
    currency: "usd", payment_intent: "pi_test_1", metadata: { refund_request_id: rr.id } };
  const stripeClient = {
    paymentIntents: { retrieve: async () => {
      assert.equal(released, true, "release DB connection before Stripe");
      return { currency: "usd", amount_received: 5000, status: "succeeded", livemode: false };
    } },
    refunds: {
      list: async () => ({ data: [], has_more: false }),
      create: async (params, options) => { created.push({ params, options }); return refund; },
      retrieve: async () => refund
    }
  };
  const applyRefund = async (db, value) => {
    assert.equal(db, database);
    assert.equal(value, refund);
    return { status: value.status, refundId: value.id };
  };
  return { rr, refund, created, stripeClient, database, applyRefund };
}

test("refund rollout requires an explicit flag and a test key", () => {
  assert.equal(adminRefundsEnabled({ ENABLE_ADMIN_REFUNDS: "true", STRIPE_SECRET_KEY: "sk_test_dummy" }), true);
  for (const key of [undefined, "sk_live_dummy", "rk_live_dummy"]) {
    assert.equal(adminRefundsEnabled({ ENABLE_ADMIN_REFUNDS: "true", STRIPE_SECRET_KEY: key }), false);
  }
  assert.equal(adminRefundsEnabled({ STRIPE_SECRET_KEY: "sk_test_dummy" }), false);
});

test("refund amount conversion rejects invalid and unsafe values", () => {
  assert.equal(refundAmountCents("42.99"), 4299);
  for (const value of ["0", "-1", "1.001", "NaN", "999999999999999999999"])
    assert.throws(() => refundAmountCents(value));
});

test("full refund uses the persisted key outside a database transaction", async () => {
  const f = fixture();
  assert.equal((await processRefund(f.rr.id, f)).status, "succeeded");
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].params.amount, 5000);
  assert.equal(f.created[0].options.idempotencyKey, f.rr.idempotency_key);
});

test("ambiguous history and incorrect payments never create refunds", async () => {
  for (const scenario of ["amount", "live", "external", "paginated", "duplicate"]) {
    const f = fixture();
    if (scenario === "amount" || scenario === "live") {
      f.stripeClient.paymentIntents.retrieve = async () => ({ currency: "usd", status: "succeeded",
        amount_received: scenario === "amount" ? 4999 : 5000, livemode: scenario === "live" });
    } else {
      f.stripeClient.refunds.list = async () => ({
        data: scenario === "external" ? [{ metadata: {} }] : scenario === "duplicate" ? [f.refund, f.refund] : [],
        has_more: scenario === "paginated"
      });
    }
    await assert.rejects(() => processRefund(f.rr.id, f));
    assert.equal(f.created.length, 0);
  }
});

test("retries recover the existing matching refund rather than creating another", async () => {
  const f = fixture();
  f.stripeClient.refunds.list = async () => ({ data: [f.refund], has_more: false });
  assert.equal((await processRefund(f.rr.id, f)).status, "succeeded");
  assert.equal(f.created.length, 0);
  f.rr.stripe_refund_id = f.refund.id;
  assert.equal((await processRefund(f.rr.id, f)).status, "succeeded");
  assert.equal(f.created.length, 0);
});
