import { pool } from "../config/database.js";

/**
 * Transactional notifications. A PostgreSQL trigger queues events in the same
 * transaction that marks an order paid or changes its fulfillment status.
 * No email/SMS is sent from a payment webhook or within a DB transaction.
 * Worker is opt-in and disabled by default in development and production.
 */

const EVENT_COPY = {
  order_paid: { title: "Payment received", body: "We've received your payment. The bakery will review your order shortly." },
  order_confirmed: { title: "Order accepted", body: "Your order has been accepted and will be prepared with care." },
  order_ready: { title: "Order ready", body: "Your order is ready! Please follow your delivery or pickup arrangements." },
  order_completed: { title: "Order completed", body: "Thank you for ordering from Sweet by André!" },
};

function maskId(orderId) { return String(orderId).slice(0, 8); }

async function brevoPost(path, payload) {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error("Missing BREVO_API_KEY");
  const response = await fetch(`https://api.brevo.com/v3/${path}`, {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Brevo ${path} returned HTTP ${response.status}`);
  return response.json().catch(() => ({}));
}

async function sendOne(row) {
  const copy = EVENT_COPY[row.event_type];
  if (!copy) throw new Error("Unexpected notification event");
  const orderName = `Order #${maskId(row.order_id)}`;
  const text = `Sweet by André — ${copy.title}\n${orderName}\n${copy.body}\nThank you!`;
  if (row.channel === "email") {
    const fromEmail = process.env.BREVO_SENDER_EMAIL;
    if (!fromEmail) throw new Error("BREVO_SENDER_EMAIL is not configured");
    if (!row.customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.customer_email)) {
      throw new Error("Invalid customer email");
    }
    await brevoPost("smtp/email", {
      sender: { email: fromEmail, name: "Sweet by André" },
      to: [{ email: row.customer_email, name: row.shipping_name || undefined }],
      subject: `Sweet by André: ${copy.title} — ${orderName}`,
      textContent: text,
      tags: ["order-transactional"],
    });
  } else if (row.channel === "sms") {
    // Requires documented customer opt-in and an approved sender route.
    if (row.sms_opt_in !== true) throw new Error("Customer did not consent to SMS");
    const sender = process.env.BREVO_SMS_SENDER;
    if (!sender) throw new Error("BREVO_SMS_SENDER is not configured");
    const phoneDigits = String(row.customer_phone ?? "").replace(/[\s().+-]/g, "");
    const digits = /^\d{10}$/.test(phoneDigits) ? `1${phoneDigits}` : phoneDigits;
    if (!/^1\d{10}$/.test(digits)) throw new Error("SMS recipient must be a US +1 number");
    await brevoPost("transactionalSMS/send", {
      sender, recipient: digits, content: text.replace(/\n/g, " "), type: "transactional",
      organisationPrefix: "Sweet by Andre",
    });
  } else throw new Error("Unsupported channel");
}

async function claimNotification(db) {
  const result = await db.query(`
    WITH selected AS (
      SELECT n.id FROM order_notification_outbox n
      JOIN orders o ON o.id = n.order_id
      WHERE n.attempts < 5
        AND ((n.status IN ('pending','failed') AND n.next_attempt_at <= NOW())
          OR (n.status = 'sending' AND n.claimed_at < NOW() - INTERVAL '15 minutes'))
        AND (n.channel = 'email' OR (n.channel = 'sms' AND o.sms_opt_in = TRUE AND $1::boolean))
      ORDER BY n.created_at, n.id FOR UPDATE OF n SKIP LOCKED LIMIT 1
    )
    UPDATE order_notification_outbox n SET status = 'sending', attempts = n.attempts + 1,
        claimed_at = NOW(), last_error = NULL
    FROM selected WHERE selected.id = n.id
    RETURNING n.id, n.order_id, n.event_type, n.channel, n.attempts
  `, [process.env.ENABLE_TRANSACTIONAL_SMS === "true"]);
  return result.rows[0] ?? null;
}

export async function processOrderNotificationBatch({ db = pool, send = sendOne, max = 10 } = {}) {
  if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error("Invalid batch size");
  if (process.env.ENABLE_TRANSACTIONAL_NOTIFICATIONS !== "true") {
    return { disabled: true, processed: 0, sent: 0, failed: 0 };
  }
  let sent = 0, failed = 0, processed = 0;
  for (let i = 0; i < max; i++) {
    const job = await claimNotification(db);
    if (!job) break;
    processed++;
    try {
      const detail = await db.query(`
        SELECT o.customer_email, o.customer_phone, o.shipping_name, o.sms_opt_in
        FROM orders o WHERE o.id = $1
      `, [job.order_id]);
      if (!detail.rowCount) throw new Error("Order not found");
      await send({ ...job, ...detail.rows[0] });
      await db.query(`UPDATE order_notification_outbox SET status = 'sent', sent_at = NOW(), claimed_at = NULL
        WHERE id = $1 AND status = 'sending'`, [job.id]);
      sent++;
    } catch (error) {
      // Avoid logging recipient PII, API keys, or provider response bodies.
      const reason = String(error.message || "Notification failed").slice(0, 180);
      const delayMins = Math.min(60, 2 ** Math.min(job.attempts, 5));
      await db.query(`UPDATE order_notification_outbox SET status = 'failed', claimed_at = NULL,
          next_attempt_at = NOW() + ($2 * INTERVAL '1 minute'), last_error = $3
          WHERE id = $1`, [job.id, delayMins, reason]);
      console.warn(`Order notification ${job.id} failed: ${reason}`);
      failed++;
    }
  }
  return { disabled: false, processed, sent, failed };
}

export function startNotificationWorker({ run = processOrderNotificationBatch, everyMs = 60_000 } = {}) {
  if (process.env.ENABLE_TRANSACTIONAL_NOTIFICATIONS !== "true") return null;
  if (process.env.BREVO_API_KEY == null || process.env.BREVO_SENDER_EMAIL == null) {
    console.warn("Notifications enabled but Brevo is not configured; worker not started");
    return null;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await run(); } catch (error) { console.error("Notification worker error:", error.message); }
    finally { running = false; }
  };
  const interval = setInterval(tick, everyMs);
  interval.unref?.();
  return interval;
}
