import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const { parsed = {} } = dotenv.config({ path: `${cwd}.env`, quiet: true });
const files = [
  "production-policy.unit.test.js",
  "production.http.test.js",
  "testInventoryReservation.js",
  "testInventoryConcurrency.js",
  "testInventoryCommit.js",
  "testInventoryRollback.js",
  "testInventoryReleased.js",
  "testInventoryMismatch.js",
  "testInventoryMissingVariant.js",
  "delivery-policy.unit.test.js",
  "delivery.http.test.js",
  "testStripeCheckoutRequest.js",
  "testCheckoutOrchestrator.js",
  "testCheckoutSessionResume.js",
  "testCheckoutV2Http.js",
  "testPaymentsRouterHttp.js",
  "testCheckoutDatabaseIntegration.js",
  "testStripeWebhookPaymentHttp.js",
  "testStripeWebhookEarlyPaymentHttp.js",
  "testStripeWebhookExpirationHttp.js",
  "testCheckoutExpiration.js",
  "admin-order-workflow.unit.test.js",
  "checkout-purchase-flow.http.test.js",
];

// Override only child-process configuration. Never modify the local .env or
// use the development database. Every integration test checks the DB name.
const options = {
  cwd,
  stdio: "inherit",
  env: {
    ...parsed,
    ...process.env,
    NODE_ENV: "test",
    DB_NAME: "sweet_by_andre_test",
    STRIPE_SECRET_KEY: "sk_test_local_validation_only",
    SESSION_SECRET: "local-checkout-validation-session-secret",
    FRONTEND_URL: "http://localhost:5173",
    ENABLE_STRIPE_CHECKOUT: "true",
    ENABLE_TRANSACTIONAL_NOTIFICATIONS: "false",
    ENABLE_TRANSACTIONAL_SMS: "false",
  },
};
const setup = spawnSync(process.execPath, ["tests/helpers/prepareCheckoutTestSchema.js"], options);
if (setup.status !== 0) {
  if (setup.error) console.error(setup.error.message);
  process.exit(setup.status ?? 1);
}
const deliverySetup = spawnSync(process.execPath, ["scripts/installDelivery.js"], options);
if (deliverySetup.status !== 0) process.exit(deliverySetup.status ?? 1);
const productionSetup = spawnSync(process.execPath, ["scripts/installProduction.js"], options);
if (productionSetup.status !== 0) process.exit(productionSetup.status ?? 1);
const result = spawnSync(process.execPath, [
  "--test", "--test-concurrency=1", ...files.map((file) => `tests/${file}`),
], options);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
