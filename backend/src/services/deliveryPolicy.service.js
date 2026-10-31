import { createHash } from "node:crypto";

export const DELIVERY_TIMEZONE = "America/Chicago";
export class DeliveryError extends Error {
  constructor(message, code = "DELIVERY_INVALID", status = 409) {
    super(message); this.code = code; this.status = status;
  }
}
const fail = (message) => { throw new DeliveryError(message, "DELIVERY_INVALID", 400); };
export const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validTime = (value) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const positiveLimit = (value) => value === null || (Number.isInteger(value) && value >= 1 && value <= 1000);

export function validateDeliveryConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) fail("Invalid settings");
  const allowed = ["delivery_enabled", "origin_address", "daily_limit", "minimum_subtotal_cents", "minimum_scope", "pickup_same_hours", "rates", "weekly_hours", "date_overrides"];
  if (Object.keys(config).some((key) => !allowed.includes(key))) fail("Unknown delivery setting");
  if (typeof config.delivery_enabled !== "boolean" || typeof config.pickup_same_hours !== "boolean") fail("Invalid activation settings");
  if (typeof config.origin_address !== "string" || config.origin_address.length > 500) fail("Invalid origin address");
  if (!positiveLimit(config.daily_limit)) fail("Daily limit must be between 1 and 1000");
  if (!Number.isInteger(config.minimum_subtotal_cents) || config.minimum_subtotal_cents < 0 || config.minimum_subtotal_cents > 1000000 ||
      !["delivery", "all"].includes(config.minimum_scope)) fail("Invalid minimum purchase");
  if (!Array.isArray(config.rates) || config.rates.length < 1 || config.rates.length > 10) fail("Invalid distance bands");
  let previous = 0;
  for (const band of config.rates) {
    if (!band || typeof band.up_to_miles !== "number" || !Number.isFinite(band.up_to_miles) || band.up_to_miles <= previous || band.up_to_miles > 100 ||
        !Number.isInteger(band.fee_cents) || band.fee_cents < 0 || band.fee_cents > 100000) fail("Distance bands must increase and have valid fees");
    previous = band.up_to_miles;
  }
  if (!Array.isArray(config.weekly_hours) || config.weekly_hours.length !== 7) fail("Seven days of opening hours are required");
  for (const day of config.weekly_hours) {
    if (!day || typeof day.enabled !== "boolean" || !validTime(day.start) || !validTime(day.end) || day.start >= day.end) fail("Opening time must precede closing time on the same day");
  }
  if (!Array.isArray(config.date_overrides) || config.date_overrides.length > 730) fail("Invalid date overrides");
  const dates = new Set();
  for (const day of config.date_overrides) {
    if (!day || !validDate(day.date) || dates.has(day.date) || typeof day.closed !== "boolean" || !positiveLimit(day.daily_limit)) fail("Invalid or duplicate exception date");
    if ((day.start !== null || day.end !== null) && (!validTime(day.start) || !validTime(day.end) || day.start >= day.end)) fail("Invalid exception hours");
    if (typeof day.note !== "string" || day.note.length > 300) fail("Date note is too long");
    dates.add(day.date);
  }
  if (config.delivery_enabled && !config.origin_address.trim()) fail("Set a departure address before enabling delivery");
  return structuredClone(config);
}

export function feeForMeters(meters, rates) {
  if (!Number.isSafeInteger(meters) || meters < 0) fail("Invalid road distance");
  // Compare the unrounded route distance, not a rounded display value.
  const band = rates.find((rate) => meters <= rate.up_to_miles * 1609.344);
  return band ? band.fee_cents : null;
}

export function scheduleForDate(config, date) {
  if (!validDate(date)) fail("Invalid service date");
  const weekly = config.weekly_hours[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const exception = config.date_overrides.find((day) => day.date === date);
  return {
    date, closed: exception ? exception.closed : !weekly.enabled,
    start: exception?.start ?? weekly.start, end: exception?.end ?? weekly.end,
    daily_limit: exception?.daily_limit ?? config.daily_limit,
  };
}

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DELIVERY_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function localParts(instant) {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`,
    utc: Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) };
}
export function houstonDate(instant = new Date()) { return localParts(instant).date; }
export function houstonTime(instant) { return localParts(instant).time; }
export function houstonInstant(date, time) {
  if (!validDate(date) || !validTime(time)) fail("Choose a valid date and time in Houston / Katy time");
  const target = Date.parse(`${date}T${time}:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) guess += target - localParts(new Date(guess)).utc;
  const value = new Date(guess), parts = localParts(value);
  if (parts.date !== date || parts.time !== time) fail("This local time does not exist; choose another time");
  return value;
}
export function validateAppointment(config, date, time, method, now = new Date()) {
  const instant = houstonInstant(date, time);
  if (instant.getTime() < now.getTime() + 48 * 3600000) {
    throw new DeliveryError("Please choose a date at least 48 hours ahead", "DELIVERY_NOTICE");
  }
  validateServiceWindow(config, date, time, method);
  return instant;
}
export function validateServiceWindow(config, date, time, method) {
  if (method === "delivery" || config.pickup_same_hours) {
    const day = scheduleForDate(config, date);
    if (day.closed) throw new DeliveryError("This date is unavailable. Choose another date", "DELIVERY_CLOSED");
    if (time < day.start || time >= day.end) throw new DeliveryError(`Choose a time from ${day.start} to before ${day.end} (Houston / Katy time)`, "DELIVERY_HOURS");
  }
}

export function addressHash(address) {
  return createHash("sha256").update(["shipping_street_number", "shipping_street", "shipping_unit", "shipping_city", "shipping_state", "shipping_zip_code"]
    .map((key) => String(address[key] ?? "").trim().toLowerCase()).join("\n")).digest("hex");
}
export function destinationAddress(address) {
  for (const key of ["shipping_street_number", "shipping_street", "shipping_city", "shipping_state", "shipping_zip_code"]) {
    if (typeof address[key] !== "string" || !address[key].trim() || address[key].length > 255) fail("Enter a complete delivery address");
  }
  if (!/^\d{5}(?:-\d{4})?$/.test(address.shipping_zip_code.trim()) || address.shipping_state.trim().toUpperCase() !== "TX") fail("Enter a Texas address and valid ZIP code");
  return `${address.shipping_street_number.trim()} ${address.shipping_street.trim()}, ${address.shipping_city.trim()}, TX ${address.shipping_zip_code.trim()}, USA`;
}
