import test from "node:test";
import assert from "node:assert/strict";
import { notificationSettings, buildOrderEmail, sendOrderNotification,
  processOrderNotificationBatch, startNotificationWorker } from "../src/services/orderNotifications.service.js";

const env = {
  ENABLE_TRANSACTIONAL_NOTIFICATIONS: "true", APP_ENV: "staging",
  BREVO_API_KEY: "test-provider-key", BREVO_SENDER_EMAIL: "bakery@example.com",
  TRANSACTIONAL_EMAIL_ALLOWLIST: "tester@example.com", NOTIFICATIONS_START_AT: "2026-01-01T00:00:00Z"
};
const row = { id: "job-id", order_id: "order-id", event_type: "order_paid", channel: "email",
  customer_email: "tester@example.com", shipping_name: "Test customer", total: "14.99",
  fulfillment_method: "pickup", fulfillment_at: "2026-11-05T18:00:00Z" };

test("disabled notifications touch neither database nor provider", async () => {
  const result = await processOrderNotificationBatch({ env: {}, db: { query() { throw new Error("Unexpected query"); } },
    send() { throw new Error("Unexpected send"); } });
  assert.deepEqual(result, { disabled: true, processed: 0, sent: 0, failed: 0 });
  assert.equal(startNotificationWorker({ env: {} }), null);
});

test("activation requires explicit credentials, cutoff and staging recipients", () => {
  const settings = notificationSettings(env);
  assert.equal(settings.enabled, true);
  assert.deepEqual(settings.allowlist, ["tester@example.com"]);
  assert.equal(settings.smsEnabled, false);
  for (const override of [{ BREVO_API_KEY: "" }, { BREVO_SENDER_EMAIL: "bad" },
    { NOTIFICATIONS_START_AT: "" }, { NOTIFICATIONS_START_AT: "2026-11-03" },
    { TRANSACTIONAL_EMAIL_ALLOWLIST: "" }, { TRANSACTIONAL_EMAIL_ALLOWLIST: "bad" }]) {
    assert.throws(() => notificationSettings({ ...env, ...override }));
  }
});

test("all six notices identify the order without exposing internal rejection notes", () => {
  for (const event_type of ["order_paid", "order_confirmed", "order_ready", "order_completed", "order_rejected", "order_refunded"]) {
    const content = buildOrderEmail({ ...row, event_type, reason: "internal staffing note" });
    assert.match(content.textContent, /Order ID: order-id/);
    assert.match(content.textContent, /\$14\.99/);
    assert.match(content.textContent, /Houston time/);
    assert.equal(content.textContent.includes("internal staffing note"), false);
  }
  assert.match(buildOrderEmail(row).textContent, /still needs to accept/);
  assert.match(buildOrderEmail({ ...row, event_type: "order_rejected" }).textContent, /refund has been requested/);
});

test("Brevo payload uses the verified sender, one recipient and a correlation ID", async () => {
  let calls = 0;
  const result = await sendOrderNotification(row, { settings: notificationSettings(env), fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(options.headers["api-key"], env.BREVO_API_KEY);
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.to, [{ email: row.customer_email, name: row.shipping_name }]);
    assert.equal(payload.sender.email, env.BREVO_SENDER_EMAIL);
    assert.match(payload.headers["X-Mailin-custom"], /job-id/);
    return new Response(JSON.stringify({ messageId: "provider-id" }), { status: 201 });
  } });
  assert.equal(calls, 1);
  assert.equal(result.messageId, "provider-id");
});

test("provider rejection, rate limiting and ambiguous delivery have different retry policies", async () => {
  for (const [status, kind] of [[400,"permanent"],[401,"permanent"],[429,"retry"],[500,"uncertain"],[408,"uncertain"]]) {
    await assert.rejects(() => sendOrderNotification(row, { settings: notificationSettings(env),
      fetchImpl: async () => new Response("private provider response", { status }) }), error => error.kind === kind && !error.message.includes("private"));
  }
  await assert.rejects(() => sendOrderNotification(row, { settings: notificationSettings(env),
    fetchImpl: async () => { throw new Error("secret key and recipient must not leak"); } }),
  error => error.kind === "uncertain" && !error.message.includes("secret key"));
});

test("recipient restrictions and SMS opt-out are enforced before contacting Brevo", async () => {
  let called = false;
  const options = { settings: notificationSettings(env), fetchImpl: async () => { called = true; } };
  await assert.rejects(() => sendOrderNotification({ ...row, customer_email: "other@example.com" }, options));
  await assert.rejects(() => sendOrderNotification({ ...row, channel: "sms", sms_opt_in: false }, options));
  assert.equal(called, false);
});

test("worker starts promptly and never overlaps its own batches", async () => {
  let calls = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  const worker = startNotificationWorker({ env, everyMs: 100, run: async () => { calls++; await pending; } });
  try {
    assert.equal(calls, 1);
    await new Promise(resolve => setTimeout(resolve, 230));
    assert.equal(calls, 1);
  } finally { clearInterval(worker); release(); }
});
