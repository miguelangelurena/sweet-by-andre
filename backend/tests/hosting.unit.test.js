import test from "node:test";
import assert from "node:assert/strict";
import {
  databaseOptions,
  frontendOrigins,
  stripeSecret,
  validateStagingRuntime,
} from "../src/config/hosting.js";

test("hosting uses a single Railway origin while preserving explicit local origins", () => {
  assert.deepEqual(
    frontendOrigins({ RAILWAY_PUBLIC_DOMAIN: "preview.up.railway.app" }),
    ["https://preview.up.railway.app"],
  );
  assert.deepEqual(
    frontendOrigins({
      FRONTEND_URL: "http://localhost:5173, https://preview.example",
    }),
    ["http://localhost:5173", "https://preview.example"],
  );
  assert.deepEqual(frontendOrigins({}), ["http://localhost:5173"]);
});
test("DATABASE_URL takes priority and TLS verification is never silently disabled", () => {
  const remote = databaseOptions({
    DATABASE_URL: "postgresql://example/db",
    DB_HOST: "ignored",
    DB_SSL: "true",
  });
  assert.equal(remote.connectionString, "postgresql://example/db");
  assert.equal(remote.host, undefined);
  assert.deepEqual(remote.ssl, { rejectUnauthorized: true });
  const local = databaseOptions({
    DB_HOST: "localhost",
    DB_PORT: "5432",
    DB_NAME: "local",
    DB_USER: "user",
    DB_PASSWORD: "example",
  });
  assert.equal(local.database, "local");
  assert.equal(local.port, 5432);
  assert.equal(local.ssl, undefined);
});
test("staging runs without payment credentials only when checkout is disabled and rejects live keys", () => {
  assert.equal(
    stripeSecret({ APP_ENV: "staging", ENABLE_STRIPE_CHECKOUT: "false" }),
    "sk_test_disabled_staging",
  );
  assert.throws(() =>
    stripeSecret({ APP_ENV: "staging", ENABLE_STRIPE_CHECKOUT: "true" }),
  );
  assert.throws(
    () =>
      stripeSecret({
        APP_ENV: "staging",
        STRIPE_SECRET_KEY: "sk_live_example",
      }),
    /test key/,
  );
  assert.equal(
    stripeSecret({ APP_ENV: "staging", STRIPE_SECRET_KEY: "sk_test_example" }),
    "sk_test_example",
  );
  assert.throws(() => stripeSecret({}));
});

test("staging setup fails early for missing secrets or an unusable HTTPS origin", () => {
  const env = {
    APP_ENV: "staging",
    ENABLE_STRIPE_CHECKOUT: "false",
    SESSION_SECRET: "s".repeat(32),
    CSRF_SECRET: "a".repeat(64),
    RAILWAY_PUBLIC_DOMAIN: "preview.up.railway.app",
  };
  assert.doesNotThrow(() => validateStagingRuntime(env));
  assert.throws(
    () => validateStagingRuntime({ ...env, SESSION_SECRET: "" }),
    /SESSION_SECRET/,
  );
  assert.throws(
    () => validateStagingRuntime({ ...env, CSRF_SECRET: "invalid" }),
    /CSRF_SECRET/,
  );
  assert.throws(
    () =>
      validateStagingRuntime({ ...env, FRONTEND_URL: "http://localhost:5173" }),
    /HTTPS/,
  );
});
