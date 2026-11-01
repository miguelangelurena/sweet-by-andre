import test from "node:test";
import assert from "node:assert/strict";
import {
  fulfillmentAvailability,
  hasDeliveryAddress,
  formatServiceTime,
} from "../src/utils/fulfillment.js";

const options = {
  earliest_date: "2026-11-03",
  earliest_time: "20:46",
  pickup_same_hours: false,
  days: [
    {
      date: "2026-11-03",
      start: "18:00",
      end: "21:00",
      closed: false,
      remaining: 2,
    },
    {
      date: "2026-11-04",
      start: "18:00",
      end: "21:00",
      closed: false,
      remaining: 0,
    },
    {
      date: "2026-11-05",
      start: "19:00",
      end: "22:00",
      closed: true,
      remaining: 0,
    },
    {
      date: "2026-11-06",
      start: "19:00",
      end: "22:00",
      closed: false,
      remaining: null,
    },
  ],
};
const form = {
  fulfillment_method: "delivery",
  fulfillment_date: "2026-11-03",
  fulfillment_time: "",
};
test("a date with no remaining time after the notice cutoff cannot be booked", () => {
  const result = fulfillmentAvailability(form, options);
  assert.equal(result.slots.length, 0);
  assert.match(result.dateError, /No times remain/);
});
test("time slots respect the notice cutoff and exclude closing time", () => {
  const result = fulfillmentAvailability(form, {
    ...options,
    earliest_time: "20:30",
  });
  assert.deepEqual(result.slots, ["20:30", "20:45"]);
  assert.equal(result.dateError, "");
  assert.match(
    fulfillmentAvailability(
      { ...form, fulfillment_time: "21:00" },
      { ...options, earliest_time: "20:30" },
    ).timeError,
    /available times/,
  );
});
test("full and closed delivery dates are rejected, without restricting coordinated pickup", () => {
  assert.match(
    fulfillmentAvailability(
      { ...form, fulfillment_date: "2026-11-04" },
      options,
    ).dateError,
    /booked/,
  );
  assert.match(
    fulfillmentAvailability(
      { ...form, fulfillment_date: "2026-11-05" },
      options,
    ).dateError,
    /unavailable/,
  );
  assert.equal(
    fulfillmentAvailability(
      {
        ...form,
        fulfillment_method: "pickup",
        fulfillment_date: "2026-11-05",
        fulfillment_time: "12:00",
      },
      options,
    ).dateError,
    "",
  );
});
test("pickup is still subject to preparation capacity and its booking window", () => {
  const pickup = {
    ...form,
    fulfillment_method: "pickup",
    fulfillment_date: "2026-11-04",
  };
  const production = {
    days: [{ date: "2026-11-04", closed: false, remaining: 2 }],
  };
  assert.equal(
    fulfillmentAvailability(pickup, options, production, 2).dateError,
    "",
  );
  assert.match(
    fulfillmentAvailability(pickup, options, production, 3).dateError,
    /cannot prepare/,
  );
  assert.match(
    fulfillmentAvailability(
      { ...pickup, fulfillment_date: "2026-11-07" },
      options,
      production,
      1,
    ).dateError,
    /booking window/,
  );
});

test("scheduled pickup follows opening hours but does not consume delivery places", () => {
  const config = { ...options, pickup_same_hours: true };
  const pickup = {
    ...form,
    fulfillment_method: "pickup",
    fulfillment_date: "2026-11-04",
    fulfillment_time: "18:30",
  };
  assert.equal(fulfillmentAvailability(pickup, config).dateError, "");
  assert.equal(fulfillmentAvailability(pickup, config).timeError, "");
  assert.match(
    fulfillmentAvailability(
      { ...pickup, fulfillment_date: "2026-11-05" },
      config,
    ).dateError,
    /unavailable/,
  );
});
test("coordinated pickup respects the earliest time on the first date", () => {
  const result = fulfillmentAvailability(
    { ...form, fulfillment_method: "pickup", fulfillment_time: "20:30" },
    options,
  );
  assert.match(result.timeError, /later time/);
});
test("a delivery time must be one of the currently offered quarter-hour slots", () => {
  const result = fulfillmentAvailability(
    { ...form, fulfillment_date: "2026-11-06", fulfillment_time: "20:07" },
    options,
  );
  assert.match(result.timeError, /available times/);
  assert.equal(formatServiceTime("19:00"), "7:00 PM");
});
test("a quote requires a complete Texas address and valid ZIP, without requiring a unit", () => {
  const address = {
    shipping_street_number: "100",
    shipping_street: "Test Lane",
    shipping_city: "Katy",
    shipping_state: "tx",
    shipping_zip_code: "77449",
  };
  assert.equal(hasDeliveryAddress(address), true);
  assert.equal(
    hasDeliveryAddress({ ...address, shipping_zip_code: "774" }),
    false,
  );
  assert.equal(hasDeliveryAddress({ ...address, shipping_state: "FL" }), false);
  assert.equal(
    hasDeliveryAddress({ ...address, shipping_street_number: " " }),
    false,
  );
});
