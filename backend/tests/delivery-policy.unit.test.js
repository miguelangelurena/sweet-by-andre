import test from "node:test";
import assert from "node:assert/strict";
import { feeForMeters, houstonInstant, houstonDate, scheduleForDate,
  validateAppointment, validateDeliveryConfig } from "../src/services/deliveryPolicy.service.js";
import { roadDistance } from "../src/services/roadDistance.service.js";

const rates = [{ up_to_miles: 3, fee_cents: 500 }, { up_to_miles: 5, fee_cents: 700 },
  { up_to_miles: 10, fee_cents: 1200 }, { up_to_miles: 15, fee_cents: 1800 }];
function config() {
  return { delivery_enabled: true, origin_address: "Private test origin", daily_limit: null,
    minimum_subtotal_cents: 1400, minimum_scope: "delivery", pickup_same_hours: false, rates,
    weekly_hours: Array.from({ length: 7 }, (_, day) => ({ enabled: true, start: day <= 3 ? "18:00" : "19:00", end: day <= 3 ? "21:00" : "22:00" })), date_overrides: [] };
}

test("unrounded driving meters determine every boundary without overlapping bands", () => {
  for (const [meters, fee] of [[0, 500], [4828, 500], [4829, 700], [8046, 700], [8047, 1200],
    [16093, 1200], [16094, 1800], [24140, 1800], [24141, null]]) assert.equal(feeForMeters(meters, rates), fee);
  for (const invalid of [-1, NaN, Infinity, "100", 1.5]) assert.throws(() => feeForMeters(invalid, rates));
});

test("Houston time is independent of the browser and handles both daylight offsets", () => {
  assert.equal(houstonInstant("2026-07-10", "19:00").toISOString(), "2026-07-11T00:00:00.000Z");
  assert.equal(houstonInstant("2026-12-10", "19:00").toISOString(), "2026-12-11T01:00:00.000Z");
  assert.equal(houstonDate(new Date("2026-12-11T01:00:00Z")), "2026-12-10");
  assert.throws(() => houstonInstant("2026-03-08", "02:30"));
  assert.throws(() => houstonInstant("2026-02-30", "19:00"));
});

test("48-hour notice and closing times are enforced; coordinated pickup has no delivery window", () => {
  const policy = config(), now = new Date("2026-10-01T00:00:00Z");
  assert.throws(() => validateAppointment(policy, "2026-10-01", "19:30", "delivery", now), /48 hours/);
  assert.doesNotThrow(() => validateAppointment(policy, "2026-10-04", "18:00", "delivery", now));
  assert.throws(() => validateAppointment(policy, "2026-10-04", "21:00", "delivery", now), /before/);
  assert.throws(() => validateAppointment(policy, "2026-10-08", "18:30", "delivery", now), /19:00/);
  assert.doesNotThrow(() => validateAppointment(policy, "2026-10-08", "12:00", "pickup", now));
});

test("date closures and custom hours override the weekly schedule", () => {
  const policy = config();
  policy.date_overrides = [{ date: "2026-10-04", closed: true, start: null, end: null, daily_limit: null, note: "Private" },
    { date: "2026-10-05", closed: false, start: "17:00", end: "18:00", daily_limit: 2, note: "" }];
  assert.equal(scheduleForDate(policy, "2026-10-04").closed, true);
  assert.deepEqual(scheduleForDate(policy, "2026-10-05"), { date: "2026-10-05", closed: false, start: "17:00", end: "18:00", daily_limit: 2 });
  assert.throws(() => validateAppointment(policy, "2026-10-04", "18:00", "delivery", new Date("2026-10-01")), /unavailable/);
  assert.doesNotThrow(() => validateAppointment(policy, "2026-10-04", "12:00", "pickup", new Date("2026-10-01")));
  policy.pickup_same_hours = true;
  assert.throws(() => validateAppointment(policy, "2026-10-04", "18:00", "pickup", new Date("2026-10-01")), /unavailable/);
});

test("invalid administrator settings are rejected and a blank daily limit means unlimited", () => {
  assert.doesNotThrow(() => validateDeliveryConfig(config()));
  for (const value of [0, -1, 1.5, 1001]) assert.throws(() => validateDeliveryConfig({ ...config(), daily_limit: value }));
  assert.throws(() => validateDeliveryConfig({ ...config(), rates: [rates[1], rates[0]] }));
  assert.throws(() => validateDeliveryConfig({ ...config(), origin_address: "" }));
  const policy = config(); policy.weekly_hours[0].start = "23:00";
  assert.throws(() => validateDeliveryConfig(policy));
  policy.weekly_hours[0].start = "18:00";
  policy.date_overrides = [{ date: "2026-02-30", closed: true, start: null, end: null, daily_limit: null, note: "" }];
  assert.throws(() => validateDeliveryConfig(policy));
});

test("road-distance adapter requests driving meters and fails closed when routing is unavailable", async (t) => {
  const oldKey = process.env.GOOGLE_ROUTES_API_KEY;
  try {
    delete process.env.GOOGLE_ROUTES_API_KEY;
    await assert.rejects(roadDistance.measure("origin", "destination"), { code: "DELIVERY_NOT_CONFIGURED" });
    process.env.GOOGLE_ROUTES_API_KEY = "unit-test-key";
    const mockedFetch = t.mock.method(globalThis, "fetch", async (url, options) => {
      assert.equal(url, "https://routes.googleapis.com/directions/v2:computeRoutes");
      assert.equal(options.headers["X-Goog-FieldMask"], "routes.distanceMeters");
      assert.equal(options.headers["X-Goog-Api-Key"], "unit-test-key");
      const body = JSON.parse(options.body);
      assert.equal(body.travelMode, "DRIVE"); assert.equal(body.origin.address, "origin"); assert.equal(body.destination.address, "destination");
      return new Response(JSON.stringify({ routes: [{ distanceMeters: 8047 }] }));
    });
    assert.equal(await roadDistance.measure("origin", "destination"), 8047);
    mockedFetch.mock.mockImplementation(async () => new Response("unavailable", { status: 503 }));
    await assert.rejects(roadDistance.measure("origin", "destination"), { code: "DELIVERY_ROUTE_UNAVAILABLE" });
    mockedFetch.mock.mockImplementation(async () => new Response(JSON.stringify({ routes: [] })));
    await assert.rejects(roadDistance.measure("origin", "destination"), { code: "DELIVERY_NO_ROUTE" });
  } finally {
    if (oldKey === undefined) delete process.env.GOOGLE_ROUTES_API_KEY; else process.env.GOOGLE_ROUTES_API_KEY = oldKey;
  }
});
