import test from "node:test";
import assert from "node:assert/strict";
import { stripeSecret, validateProductionRuntime } from "../src/config/hosting.js";
import { assertProductionDatabase } from "../src/config/productionDatabase.js";

const valid = {
  APP_ENV: "production", NODE_ENV: "production", SERVE_FRONTEND: "true",
  FRONTEND_URL: "https://bakery.example", PRODUCTION_DB_NAME: "bakery_live",
  SESSION_SECRET: "s".repeat(32), CSRF_SECRET: "a".repeat(64),
  ENABLE_STRIPE_CHECKOUT: "false", ENABLE_ADMIN_REFUNDS: "false",
  ENABLE_TRANSACTIONAL_NOTIFICATIONS: "false", ENABLE_TRANSACTIONAL_SMS: "false",
};

test("closed production starts without payment credentials and refuses sandbox keys", () => {
  assert.doesNotThrow(() => validateProductionRuntime(valid));
  assert.equal(stripeSecret(valid), "sk_test_disabled_production");
  assert.throws(() => validateProductionRuntime({ ...valid, STRIPE_SECRET_KEY: "sk_test_example" }), /test keys/);
  assert.throws(() => stripeSecret({ ...valid, ENABLE_STRIPE_CHECKOUT: "true", STRIPE_SECRET_KEY: "sk_live_example" }), /disabled/);
});

test("production requires explicit HTTPS origin, database identity and strong secrets", () => {
  for (const changes of [
    { FRONTEND_URL: "" }, { FRONTEND_URL: "http://bakery.example" },
    { FRONTEND_URL: "https://bakery.example/path" }, { FRONTEND_URL: "https://one.example,https://two.example" },
    { PRODUCTION_DB_NAME: "" }, { SESSION_SECRET: "short" }, { CSRF_SECRET: "bad" },
    { APP_ENV: "staging" }, { NODE_ENV: "development" }, { SERVE_FRONTEND: "false" },
  ]) assert.throws(() => validateProductionRuntime({ ...valid, ...changes }));
});

test("each external side effect must be explicitly disabled during preparation", () => {
  for (const flag of ["ENABLE_STRIPE_CHECKOUT", "ENABLE_ADMIN_REFUNDS", "ENABLE_TRANSACTIONAL_NOTIFICATIONS", "ENABLE_TRANSACTIONAL_SMS"]) {
    assert.throws(() => validateProductionRuntime({ ...valid, [flag]: "true" }), new RegExp(flag));
    assert.throws(() => validateProductionRuntime({ ...valid, [flag]: undefined }), new RegExp(flag));
  }
});

test("production refuses development, test, staging and mismatched database identities", async () => {
  for (const name of ["sweet_by_andre_dev", "sweet_by_andre_test", "bakery_staging_123", "sweet_by_andre_restore_abcd"]) {
    const client = { query: async () => ({ rows: [{ name }] }) };
    await assert.rejects(assertProductionDatabase(client, { PRODUCTION_DB_NAME: name }, { requireInitialized: false }), /refuses/);
  }
  await assert.rejects(assertProductionDatabase({ query: async () => ({ rows: [{ name: "other_database" }] }) }, valid, { requireInitialized: false }), /refuses/);
});
