import { pool } from "../config/database.js";
import { roadDistance } from "./roadDistance.service.js";
import { DeliveryError, addressHash, destinationAddress, feeForMeters, houstonDate,
  houstonTime, scheduleForDate, validateAppointment, validateServiceWindow } from "./deliveryPolicy.service.js";

export async function readDeliverySettings(db = pool, lock = false) {
  const result = await db.query(`SELECT version, config FROM delivery_settings WHERE id = TRUE ${lock ? "FOR UPDATE" : ""}`);
  if (!result.rowCount) throw new DeliveryError("Delivery settings are not configured", "DELIVERY_NOT_CONFIGURED", 503);
  return result.rows[0];
}
export function deliveryReady(config) {
  return config.delivery_enabled && Boolean(config.origin_address.trim()) && Boolean(process.env.GOOGLE_ROUTES_API_KEY);
}

export async function deliveryCounts(db, from, to, excludeOrder = null) {
  const result = await db.query(`
    SELECT o.service_date::text AS date, COUNT(*)::int AS booked
    FROM orders o WHERE o.fulfillment_method = 'delivery'
      AND o.service_date BETWEEN $1::date AND $2::date
      AND ($3::uuid IS NULL OR o.id <> $3::uuid)
      AND o.order_status <> 'cancelled'
      AND (o.payment_status = 'paid' OR (o.delivery_hold_until > NOW()
        AND NOT EXISTS (SELECT 1 FROM checkout_attempts a WHERE a.order_id = o.id AND a.status = 'expired'))
        OR EXISTS (SELECT 1 FROM checkout_attempts a WHERE a.order_id = o.id AND a.status IN ('creating','open')))
    GROUP BY o.service_date`, [from, to, excludeOrder]);
  return new Map(result.rows.map((row) => [row.date, row.booked]));
}
export async function requireDeliveryCapacity(db, config, date, excludeOrder = null) {
  const day = scheduleForDate(config, date);
  if (day.closed) throw new DeliveryError("This date is unavailable", "DELIVERY_CLOSED");
  const counts = await deliveryCounts(db, date, date, excludeOrder);
  if (day.daily_limit !== null && (counts.get(date) ?? 0) >= day.daily_limit) {
    throw new DeliveryError("All deliveries for this date are booked. Choose another date or pickup", "DELIVERY_FULL");
  }
}

export async function publicDeliverySettings() {
  const { config, version } = await readDeliverySettings();
  const from = houstonDate(), end = new Date(`${from}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 60);
  const to = end.toISOString().slice(0, 10);
  const counts = await deliveryCounts(pool, from, to);
  const days = [];
  for (let date = from; date <= to;) {
    const day = scheduleForDate(config, date), booked = counts.get(date) ?? 0;
    days.push({ ...day, remaining: day.closed || !deliveryReady(config) ? 0 : day.daily_limit === null ? null : Math.max(0, day.daily_limit - booked) });
    const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); date = next.toISOString().slice(0, 10);
  }
  const earliest = new Date(Date.now() + 48 * 3600000 + 60000);
  return { version, timezone: "America/Chicago", delivery_available: deliveryReady(config),
    earliest_date: houstonDate(earliest), earliest_time: houstonTime(earliest),
    minimum_notice_hours: 48, minimum_subtotal_cents: config.minimum_subtotal_cents,
    minimum_scope: config.minimum_scope, pickup_same_hours: config.pickup_same_hours,
    rates: config.rates, days };
}

export async function quoteGuestDelivery(cartId, address) {
  const destination = destinationAddress(address), hash = addressHash(address);
  const { config, version } = await readDeliverySettings();
  if (!deliveryReady(config)) throw new DeliveryError("Delivery is not available yet. Choose pickup or contact the bakery", "DELIVERY_NOT_CONFIGURED", 503);
  // Serialize per-cart quote attempts, then release the transaction before
  // calling Google. Count failed attempts too, and cache unchanged addresses.
  const client = await pool.connect();
  let quote;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`delivery-quote:${cartId}`]);
    const cached = await client.query(`SELECT id, distance_meters, fee_cents, expires_at FROM delivery_quotes
      WHERE guest_cart_id = $1 AND address_hash = $2 AND policy_version = $3
      AND status = 'ready' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`, [cartId, hash, version]);
    if (cached.rowCount) { await client.query("COMMIT"); return cached.rows[0]; }
    const count = await client.query("SELECT COUNT(*)::int AS count FROM delivery_quotes WHERE guest_cart_id = $1 AND created_at > NOW() - INTERVAL '10 minutes'", [cartId]);
    if (count.rows[0].count >= 10) throw new DeliveryError("Too many quote requests. Please try again in a few minutes", "DELIVERY_RATE_LIMIT", 429);
    quote = (await client.query(`INSERT INTO delivery_quotes (guest_cart_id,address_hash,policy_version)
      VALUES ($1,$2,$3) RETURNING id,expires_at`, [cartId, hash, version])).rows[0];
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  try {
    const meters = await roadDistance.measure(config.origin_address, destination);
    const fee = feeForMeters(meters, config.rates);
    if (fee === null) {
      await pool.query("UPDATE delivery_quotes SET status='outside_area' WHERE id=$1", [quote.id]);
      throw new DeliveryError("This address needs a custom delivery quote. Contact the bakery or choose pickup", "DELIVERY_OUTSIDE_AREA", 422);
    }
    await pool.query("UPDATE delivery_quotes SET status='ready',distance_meters=$2,fee_cents=$3 WHERE id=$1", [quote.id, meters, fee]);
    return { ...quote, distance_meters: meters, fee_cents: fee };
  } catch (error) {
    await pool.query("UPDATE delivery_quotes SET status='failed' WHERE id=$1 AND status='pending'", [quote.id]);
    throw error;
  }
}

// Must run inside the order transaction. The settings row lock serializes
// last-slot reservations with other orders and administrator edits.
export async function priceOrderFulfillment(db, { method, appointment, cartId, quoteId, address, subtotalCents }) {
  const { config, version } = await readDeliverySettings(db, true);
  const date = houstonDate(appointment), time = houstonTime(appointment);
  validateAppointment(config, date, time, method);
  if ((method === "delivery" || config.minimum_scope === "all") && subtotalCents < config.minimum_subtotal_cents) {
    throw new DeliveryError(`The minimum purchase is $${(config.minimum_subtotal_cents / 100).toFixed(2)} before delivery`, "DELIVERY_MINIMUM");
  }
  if (method === "pickup") return { feeCents: 0, meters: null, date, version };
  if (!deliveryReady(config)) throw new DeliveryError("Delivery is not available. Choose pickup or contact the bakery", "DELIVERY_NOT_CONFIGURED", 503);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(quoteId ?? "")) throw new DeliveryError("Calculate delivery before placing the order", "DELIVERY_QUOTE_REQUIRED");
  const result = await db.query(`SELECT * FROM delivery_quotes WHERE id=$1 AND guest_cart_id=$2
    AND status='ready' AND expires_at>NOW()`, [quoteId, cartId]);
  const quote = result.rows[0];
  if (!quote || quote.policy_version !== version || quote.address_hash !== addressHash(address) ||
      quote.fee_cents !== feeForMeters(quote.distance_meters, config.rates)) {
    throw new DeliveryError("Your delivery quote expired or the details changed. Calculate delivery again", "DELIVERY_QUOTE_EXPIRED");
  }
  await requireDeliveryCapacity(db, config, date);
  return { feeCents: quote.fee_cents, meters: quote.distance_meters, date, version };
}

// Before a new Stripe attempt, keep the daily slot held throughout Checkout.
// Existing creating/open attempts already hold their slot and are replayed.
export async function reserveOrderDelivery(db, orderId, expiresAt) {
  const { rows: [order] } = await db.query("SELECT fulfillment_method, fulfillment_at, service_date::text AS service_date, delivery_hold_until FROM orders WHERE id=$1", [orderId]);
  if (order?.fulfillment_method !== "delivery") return;
  const { config } = await readDeliverySettings(db, true);
  if (!deliveryReady(config)) throw new DeliveryError("Delivery is currently unavailable. Contact the bakery about your order", "DELIVERY_NOT_CONFIGURED");
  if (!order.delivery_hold_until || order.delivery_hold_until.getTime() <= Date.now()) {
    throw new DeliveryError("This order's delivery hold expired. Please start a new order with a current quote", "DELIVERY_HOLD_EXPIRED");
  }
  validateServiceWindow(config, order.service_date, houstonTime(order.fulfillment_at), "delivery");
  await requireDeliveryCapacity(db, config, order.service_date, orderId);
  await db.query("UPDATE orders SET delivery_hold_until=$2 WHERE id=$1", [orderId, expiresAt]);
}
