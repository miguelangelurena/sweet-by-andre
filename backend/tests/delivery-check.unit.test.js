import test from "node:test";
import assert from "node:assert/strict";
import { checkDelivery } from "../scripts/checkDelivery.js";

const rates = [
  { up_to_miles: 3, fee_cents: 500 },
  { up_to_miles: 5, fee_cents: 700 },
  { up_to_miles: 10, fee_cents: 1200 },
  { up_to_miles: 15, fee_cents: 1800 },
];
const config = {
  origin_address: "Private departure address",
  delivery_enabled: false,
  minimum_subtotal_cents: 1400,
  minimum_scope: "delivery",
  rates,
};
const db = {
  query: async (sql) => {
    assert.match(sql, /^SELECT /);
    return { rowCount: 1, rows: [{ config }] };
  },
};
const env = { GOOGLE_ROUTES_API_KEY: "fake-local-test-key" };

test("missing key prevents a paid route request and does not reveal the origin", async () => {
  const result = await checkDelivery({
    db,
    env: {},
    destination: "Test destination",
    measure: () => assert.fail("must not call Google"),
  });
  assert.equal(result.ready, false);
  assert.equal(result.route_tested, false);
  assert.ok(!JSON.stringify(result).includes(config.origin_address));
});
test("missing origin prevents a route request", async () => {
  const result = await checkDelivery({
    db: {
      query: async () => ({
        rows: [{ config: { ...config, origin_address: " " } }],
        rowCount: 1,
      }),
    },
    env,
    destination: "Test",
    measure: () => assert.fail("must not call Google"),
  });
  assert.equal(result.ready, false);
});
test("a configuration check without a destination never calls the provider", async () => {
  const result = await checkDelivery({
    db,
    env,
    measure: () => assert.fail("must not call Google"),
  });
  assert.equal(result.ready, true);
  assert.equal(result.route_tested, false);
});
test("a real route can be checked while delivery remains disabled", async () => {
  const result = await checkDelivery({
    db,
    env,
    destination: "Public test destination",
    measure: async (origin, destination) => {
      assert.equal(origin, config.origin_address);
      assert.equal(destination, "Public test destination");
      return 4829; // Just above three unrounded miles: the second band.
    },
  });
  assert.equal(result.route_tested, true);
  assert.equal(result.fee_cents, 700);
  assert.equal(result.delivery_enabled, false);
  assert.equal(config.delivery_enabled, false);
});
test("an address beyond the configured area produces a custom quote, never free delivery", async () => {
  const result = await checkDelivery({
    db,
    env,
    destination: "Far test destination",
    measure: async () => 30000,
  });
  assert.equal(result.route_tested, true);
  assert.equal(result.fee_cents, null);
});

test("ZIP checks need no Google key or origin and never call the provider", async () => {
  const zipDb = {
    query: async () => ({
      rowCount: 1,
      rows: [
        {
          config: {
            ...config,
            pricing_method: "zip_code",
            origin_address: "",
            zip_rates: [{ zip_code: "77449", fee_cents: 500 }],
          },
        },
      ],
    }),
  };
  const result = await checkDelivery({
    db: zipDb,
    env: {},
    zipCode: "77449-1234",
    measure: () => assert.fail("must not call Google"),
  });
  assert.equal(result.ready, true);
  assert.equal(result.route_tested, false);
  assert.equal(result.zip_tested, true);
  assert.equal(result.zip_code, "77449");
  assert.equal(result.fee_cents, 500);
  const outside = await checkDelivery({ db: zipDb, env: {}, zipCode: "77450" });
  assert.equal(outside.fee_cents, null);
});
