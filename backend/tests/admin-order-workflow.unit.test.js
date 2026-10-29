import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_FULFILLMENT_TRANSITIONS,
  transitionPaidOrder,
} from "../src/services/adminOrderWorkflow.service.js";

const ORDER_ID = "227de69b-eaf8-4e65-89d9-eee30bb2f089";

function fakeDatabase({ status = "pending", payment = "paid", exists = true } = {}) {
  const order = exists ? { id: ORDER_ID, payment_status: payment, order_status: status } : null;
  const statements = [];
  return {
    order,
    statements,
    async query(sql, args) {
      statements.push({ sql, args });
      if (/^\s*UPDATE orders\b/.test(sql)) {
        assert.match(sql, /payment_status = 'paid'/);
        if (order && order.payment_status === "paid" && order.order_status === args[1] && order.id === args[0]) {
          order.order_status = args[2];
          return { rowCount: 1, rows: [{ ...order }] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (/^\s*SELECT id, payment_status, order_status FROM orders\b/.test(sql)) {
        return order && order.id === args[0]
          ? { rowCount: 1, rows: [{ ...order }] }
          : { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("fulfillment status sequence has exactly four allowed forward transitions", () => {
  assert.deepEqual(ALLOWED_FULFILLMENT_TRANSITIONS, {
    confirmed: "pending", preparing: "confirmed", ready: "preparing", completed: "ready",
  });
});

test("paid order progresses one stage at a time", async () => {
  const db = fakeDatabase();
  for (const nextStatus of ["confirmed", "preparing", "ready", "completed"]) {
    const result = await transitionPaidOrder(db, ORDER_ID, nextStatus);
    assert.equal(result.outcome, "updated");
    assert.equal(result.order.order_status, nextStatus);
  }
  assert.equal(db.order.order_status, "completed");
  assert.equal(db.statements.length, 4);
});

test("an unpaid order cannot advance", async () => {
  const db = fakeDatabase({ payment: "pending" });
  const result = await transitionPaidOrder(db, ORDER_ID, "confirmed");
  assert.equal(result.outcome, "conflict");
  assert.equal(db.order.order_status, "pending");
});

test("skipping stages and retrying a completed transition do not change an order", async () => {
  const db = fakeDatabase();
  assert.equal((await transitionPaidOrder(db, ORDER_ID, "completed")).outcome, "conflict");
  assert.equal((await transitionPaidOrder(db, ORDER_ID, "confirmed")).outcome, "updated");
  assert.equal((await transitionPaidOrder(db, ORDER_ID, "confirmed")).outcome, "conflict");
  assert.equal(db.order.order_status, "confirmed");
});

test("invalid or cancellation/refund statuses are never accepted here", async () => {
  const db = fakeDatabase();
  for (const value of ["paid", "refunded", "refund_pending", "cancelled", "pending", "anything", undefined]) {
    assert.equal((await transitionPaidOrder(db, ORDER_ID, value)).outcome, "invalid_status");
  }
  assert.equal(db.statements.length, 0);
});

test("missing order yields not_found", async () => {
  const db = fakeDatabase({ exists: false });
  assert.equal((await transitionPaidOrder(db, ORDER_ID, "confirmed")).outcome, "not_found");
});
