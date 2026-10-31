import { pool } from "../config/database.js";
import {
  DeliveryError,
  houstonDate,
  validDate,
} from "./deliveryPolicy.service.js";

export class ProductionError extends DeliveryError {
  constructor(message, code = "PRODUCTION_INVALID", status = 409) {
    super(message, code, status);
  }
}
const validCapacity = (value) =>
  value === null || (Number.isInteger(value) && value >= 1 && value <= 1000000);
export function validateProductionConfig(config) {
  const fail = (message) => {
    throw new ProductionError(message, "PRODUCTION_INVALID", 400);
  };
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    Object.keys(config).some(
      (key) =>
        !["daily_capacity", "weekly_capacity", "date_overrides"].includes(key),
    )
  )
    fail("Invalid production settings");
  if (!validCapacity(config.daily_capacity))
    fail(
      "Daily capacity must be a positive whole number, or blank for no limit",
    );
  if (
    !Array.isArray(config.weekly_capacity) ||
    config.weekly_capacity.length !== 7
  )
    fail("Configure all seven weekdays");
  for (const day of config.weekly_capacity)
    if (
      !day ||
      typeof day.enabled !== "boolean" ||
      !validCapacity(day.capacity)
    )
      fail("Invalid weekday capacity");
  if (
    !Array.isArray(config.date_overrides) ||
    config.date_overrides.length > 730
  )
    fail("Invalid exception dates");
  const dates = new Set();
  for (const day of config.date_overrides) {
    if (
      !day ||
      !validDate(day.date) ||
      dates.has(day.date) ||
      typeof day.closed !== "boolean" ||
      !validCapacity(day.capacity) ||
      typeof day.note !== "string" ||
      day.note.length > 300
    )
      fail("Invalid or duplicate exception date");
    dates.add(day.date);
  }
  return structuredClone(config);
}
export function productionDay(config, date) {
  if (!validDate(date))
    throw new ProductionError(
      "Invalid preparation date",
      "PRODUCTION_DATE",
      400,
    );
  const weekly =
    config.weekly_capacity[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const exception = config.date_overrides.find((day) => day.date === date);
  return {
    date,
    closed: exception ? exception.closed : !weekly.enabled,
    capacity: exception?.capacity ?? weekly.capacity ?? config.daily_capacity,
  };
}
export async function readProductionSettings(db = pool, lock = false) {
  const result = await db.query(
    `SELECT version,config FROM production_settings WHERE id=TRUE ${lock ? "FOR UPDATE" : ""}`,
  );
  if (!result.rowCount)
    throw new ProductionError(
      "Production settings unavailable",
      "PRODUCTION_UNAVAILABLE",
      503,
    );
  return result.rows[0];
}
export async function productionCounts(db, from, to, excludeOrder = null) {
  const result = await db.query(
    `SELECT r.service_date::text AS date,SUM(r.points)::int AS used
    FROM production_reservations r JOIN orders o ON o.id=r.order_id
    WHERE r.service_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR r.order_id<>$3)
      AND o.order_status<>'cancelled' AND (r.status='committed' OR (r.status='held' AND
        (r.expires_at>NOW() OR EXISTS (SELECT 1 FROM checkout_attempts a WHERE a.order_id=r.order_id AND a.status IN ('creating','open')))))
    GROUP BY r.service_date`,
    [from, to, excludeOrder],
  );
  return new Map(result.rows.map((row) => [row.date, row.used]));
}
async function requireCapacity(db, config, date, points, excludeOrder = null) {
  const day = productionDay(config, date);
  if (day.closed)
    throw new ProductionError(
      "The bakery is not taking preparation orders for this date. Please choose another date",
      "PRODUCTION_CLOSED",
    );
  const used =
    (await productionCounts(db, date, date, excludeOrder)).get(date) ?? 0;
  if (day.capacity !== null && used + points > day.capacity)
    throw new ProductionError(
      "There is not enough preparation capacity for this order on that date. Please choose another date",
      "PRODUCTION_FULL",
    );
}
export async function productionOptions(admin = false) {
  const { config, version } = await readProductionSettings();
  const from = houstonDate(),
    last = new Date(`${from}T12:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 60);
  const used = await productionCounts(
    pool,
    from,
    last.toISOString().slice(0, 10),
  );
  const days = [];
  for (
    const next = new Date(`${from}T12:00:00Z`);
    next <= last;
    next.setUTCDate(next.getUTCDate() + 1)
  ) {
    const day = productionDay(config, next.toISOString().slice(0, 10)),
      booked = used.get(day.date) ?? 0;
    days.push({
      ...day,
      used: booked,
      remaining: day.closed
        ? 0
        : day.capacity === null
          ? null
          : Math.max(0, day.capacity - booked),
    });
  }
  return admin
    ? { version, config, days }
    : { version, timezone: "America/Chicago", days };
}
async function orderProduction(db, orderId) {
  const {
    rows: [row],
  } = await db.query(
    `SELECT COALESCE(SUM(quantity::bigint*production_points),0)::bigint AS points
    FROM order_items WHERE order_id=$1 AND inventory_mode='made_to_order'`,
    [orderId],
  );
  const points = Number(row.points);
  if (!Number.isSafeInteger(points) || points < 0 || points > 1000000000)
    throw new ProductionError(
      "Order preparation load is too large",
      "PRODUCTION_LOAD",
      400,
    );
  return points;
}
// Order creation and Checkout both acquire locks in this order:
// variants -> delivery settings -> production settings. No network calls here.
export async function holdOrderProduction(db, orderId) {
  const points = await orderProduction(db, orderId);
  if (points === 0) return;
  const { config, version } = await readProductionSettings(db, true);
  const {
    rows: [order],
  } = await db.query(
    "SELECT service_date::text AS date,fulfillment_at FROM orders WHERE id=$1",
    [orderId],
  );
  if (!order?.date || !order.fulfillment_at)
    throw new ProductionError(
      "Choose a preparation date for this order",
      "PRODUCTION_DATE",
    );
  await requireCapacity(db, config, order.date, points);
  await db.query(
    `INSERT INTO production_reservations (order_id,service_date,points,policy_version,expires_at)
    VALUES ($1,$2,$3,$4,NOW()+INTERVAL '30 minutes')`,
    [orderId, order.date, points, version],
  );
}
export async function reserveOrderProduction(db, orderId, expiresAt) {
  const points = await orderProduction(db, orderId);
  if (points === 0) return;
  const { config } = await readProductionSettings(db, true);
  const {
    rows: [reservation],
  } = await db.query(
    `SELECT r.*,r.service_date::text AS date,o.service_date::text AS order_date
    FROM production_reservations r JOIN orders o ON o.id=r.order_id WHERE r.order_id=$1 FOR UPDATE OF r`,
    [orderId],
  );
  if (
    !reservation ||
    reservation.status !== "held" ||
    reservation.points !== points ||
    reservation.date !== reservation.order_date
  )
    throw new ProductionError(
      "This preparation reservation needs review. Please contact the bakery",
      "PRODUCTION_REVIEW",
    );
  if (reservation.expires_at.getTime() <= Date.now())
    throw new ProductionError(
      "This order's preparation hold expired. Please start a new order to check availability again",
      "PRODUCTION_HOLD_EXPIRED",
    );
  await requireCapacity(db, config, reservation.date, points, orderId);
  await db.query(
    "UPDATE production_reservations SET expires_at=$2 WHERE order_id=$1",
    [orderId, expiresAt],
  );
}
export async function commitOrderProduction(db, orderId) {
  const points = await orderProduction(db, orderId);
  if (points === 0) return;
  const {
    rows: [reservation],
  } = await db.query(
    `SELECT r.*,r.service_date::text AS date,o.service_date::text AS order_date
    FROM production_reservations r JOIN orders o ON o.id=r.order_id WHERE r.order_id=$1 FOR UPDATE OF r`,
    [orderId],
  );
  if (
    !reservation ||
    reservation.points !== points ||
    reservation.date !== reservation.order_date ||
    !["held", "committed"].includes(reservation.status)
  )
    throw new ProductionError(
      "Preparation reservation does not match this paid order",
      "PRODUCTION_REVIEW",
    );
  if (reservation.status === "held")
    await db.query(
      "UPDATE production_reservations SET status='committed' WHERE order_id=$1",
      [orderId],
    );
}
export async function releaseOrderProduction(db, orderId) {
  await db.query(
    "UPDATE production_reservations SET status='released' WHERE order_id=$1 AND status='held'",
    [orderId],
  );
}
