import test from "node:test";
import assert from "node:assert/strict";
import {
  productionDay,
  validateProductionConfig,
} from "../src/services/production.service.js";

function config() {
  return {
    daily_capacity: 10,
    weekly_capacity: Array.from({ length: 7 }, () => ({
      enabled: true,
      capacity: null,
    })),
    date_overrides: [],
  };
}
test("preparation capacity combines daily defaults, weekdays and date overrides", () => {
  const settings = config();
  assert.equal(productionDay(settings, "2026-11-01").capacity, 10);
  settings.weekly_capacity[0] = { enabled: false, capacity: 5 };
  assert.equal(productionDay(settings, "2026-11-01").closed, true);
  settings.date_overrides = [
    { date: "2026-11-01", closed: false, capacity: 3, note: "Internal" },
  ];
  assert.deepEqual(productionDay(settings, "2026-11-01"), {
    date: "2026-11-01",
    closed: false,
    capacity: 3,
  });
  settings.daily_capacity = null;
  assert.equal(productionDay(settings, "2026-11-02").capacity, null);
});
test("preparation settings reject invalid, ambiguous and duplicate limits", () => {
  assert.doesNotThrow(() => validateProductionConfig(config()));
  for (const capacity of [0, -1, 1.5, NaN, Infinity, 1000001, "10"]) {
    assert.throws(() =>
      validateProductionConfig({ ...config(), daily_capacity: capacity }),
    );
  }
  assert.doesNotThrow(() =>
    validateProductionConfig({ ...config(), daily_capacity: null }),
  );
  const exception = {
    date: "2026-11-01",
    closed: true,
    capacity: null,
    note: "",
  };
  assert.throws(() =>
    validateProductionConfig({
      ...config(),
      date_overrides: [exception, exception],
    }),
  );
  assert.throws(() =>
    validateProductionConfig({
      ...config(),
      date_overrides: [{ ...exception, date: "2026-02-30" }],
    }),
  );
  assert.throws(() => validateProductionConfig({ ...config(), unknown: true }));
  assert.throws(() =>
    validateProductionConfig({ ...config(), weekly_capacity: [] }),
  );
});
