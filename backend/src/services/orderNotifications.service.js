import { pool } from "../config/database.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COPY = {
  order_paid: ["Payment received", "We've received your payment. Andrea still needs to accept your order."],
  order_confirmed: ["Order accepted", "Andrea has accepted your order. We'll let you know when it is ready."],
  order_ready: ["Order ready", "Your order is ready. Please follow the pickup or delivery arrangements coordinated with Andrea."],
  order_completed: ["Order completed", "Your order has been marked completed. Thank you for ordering from Sweet by André!"],
  order_rejected: ["Order not accepted", "The bakery cannot fulfill your order. A full refund has been requested; we'll notify you when it is confirmed."],
  order_refunded: ["Refund confirmed", "Your full refund has been confirmed by Stripe. Your bank may take additional time to display it."],
};

export class NotificationDeliveryError extends Error {
  constructor(message, kind = "uncertain") { super(message); this.kind = kind; }
}

export function notificationSettings(env = process.env) {
  if (env.ENABLE_TRANSACTIONAL_NOTIFICATIONS !== "true") return { enabled: false };
  if (!env.BREVO_API_KEY?.trim() || !EMAIL.test(env.BREVO_SENDER_EMAIL ?? ""))
    throw new Error("Configure BREVO_API_KEY and a valid BREVO_SENDER_EMAIL");
  const value = env.NOTIFICATIONS_START_AT ?? "";
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error("Set NOTIFICATIONS_START_AT to an ISO timestamp with timezone");
  const allowlist = (env.TRANSACTIONAL_EMAIL_ALLOWLIST ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowlist.some(email => !EMAIL.test(email))) throw new Error("Invalid TRANSACTIONAL_EMAIL_ALLOWLIST");
  if (env.APP_ENV === "staging" && !allowlist.length)
    throw new Error("Staging notifications require TRANSACTIONAL_EMAIL_ALLOWLIST");
  return { enabled: true, apiKey: env.BREVO_API_KEY, sender: env.BREVO_SENDER_EMAIL,
    smsEnabled: env.ENABLE_TRANSACTIONAL_SMS === "true", smsSender: env.BREVO_SMS_SENDER,
    startAt: new Date(value).toISOString(), allowlist };
}

export function buildOrderEmail(row) {
  const copy = COPY[row.event_type];
  if (!copy) throw new NotificationDeliveryError("Unsupported notification event", "permanent");
  const total = Number(row.total);
  const lines = [`Sweet by André — ${copy[0]}`, `Order #${String(row.order_id).slice(0, 8)}`, "", copy[1]];
  if (Number.isFinite(total)) lines.push(`Order total: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total)}`);
  if (row.fulfillment_at) {
    lines.push(`${row.fulfillment_method === "pickup" ? "Pickup" : "Service"}: ${new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago"
    }).format(new Date(row.fulfillment_at))} (Houston time)`);
  }
  lines.push(`Order ID: ${row.order_id}`, "Questions? Contact Andrea at sweetbyandre@gmail.com.");
  return { subject: `Sweet by André: ${copy[0]} — Order #${String(row.order_id).slice(0, 8)}`, textContent: lines.join("\n") };
}

export async function sendOrderNotification(row, { settings, fetchImpl = fetch }) {
  const content = buildOrderEmail(row);
  let path, payload;
  if (row.channel === "email") {
    if (!EMAIL.test(row.customer_email ?? ""))
      throw new NotificationDeliveryError("Invalid recipient email", "permanent");
    if (settings.allowlist.length && !settings.allowlist.includes(row.customer_email.toLowerCase()))
      throw new NotificationDeliveryError("Recipient is outside the test allowlist", "permanent");
    path = "smtp/email";
    payload = { sender: { email: settings.sender, name: "Sweet by André" },
      to: [{ email: row.customer_email, name: row.shipping_name || undefined }], ...content,
      tags: ["order-transactional"], headers: { "X-Mailin-custom": `notification_id:${row.id}` } };
  } else if (row.channel === "sms") {
    if (!settings.smsEnabled || row.sms_opt_in !== true || !settings.smsSender)
      throw new NotificationDeliveryError("SMS is disabled or not authorized", "permanent");
    const phone = String(row.customer_phone ?? "").replace(/[\s().+-]/g, "");
    const digits = /^\d{10}$/.test(phone) ? `1${phone}` : phone;
    if (!/^1\d{10}$/.test(digits)) throw new NotificationDeliveryError("Invalid SMS recipient", "permanent");
    path = "transactionalSMS/send";
    payload = { sender: settings.smsSender, recipient: digits,
      content: content.textContent.replace(/\n/g, " "), type: "transactional", organisationPrefix: "Sweet by Andre" };
  } else throw new NotificationDeliveryError("Unsupported notification channel", "permanent");
  let response;
  try {
    response = await fetchImpl(`https://api.brevo.com/v3/${path}`, {
      method: "POST", headers: { "api-key": settings.apiKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(12_000)
    });
  } catch {
    throw new NotificationDeliveryError("Brevo delivery outcome is unknown; review provider logs before retrying");
  }
  if (!response.ok) {
    const kind = response.status === 429 ? "retry" : response.status >= 500 || response.status === 408 ? "uncertain" : "permanent";
    throw new NotificationDeliveryError(`Brevo request returned HTTP ${response.status}`, kind);
  }
  // 'sent' means accepted by Brevo, not delivered to the recipient's inbox.
  const data = await response.json().catch(() => ({}));
  return { messageId: typeof data.messageId === "string" ? data.messageId : null };
}

const priority = alias => `CASE ${alias}.event_type WHEN 'order_paid' THEN 1 WHEN 'order_confirmed' THEN 2
  WHEN 'order_ready' THEN 3 WHEN 'order_completed' THEN 4 WHEN 'order_rejected' THEN 5 ELSE 6 END`;

async function prepareQueue(db, settings) {
  // Do not resend after a crash: the provider may have accepted the message.
  await db.query(`UPDATE order_notification_outbox SET status='uncertain',retryable=FALSE,
    last_error='Worker interrupted; verify provider logs before retrying'
    WHERE status='sending' AND claimed_at<NOW()-INTERVAL '15 minutes'`);
  // Avoid sending obsolete status notices after an order has already moved on.
  await db.query(`UPDATE order_notification_outbox n SET status='skipped',retryable=FALSE,
    last_error='Superseded by the current order status' FROM orders o
    WHERE o.id=n.order_id AND n.created_at>=$1::timestamptz AND n.status IN ('pending','failed') AND (
      (n.event_type='order_paid' AND (o.payment_status<>'paid' OR o.order_status<>'pending')) OR
      (n.event_type='order_confirmed' AND (o.payment_status<>'paid' OR o.order_status<>'confirmed')) OR
      (n.event_type='order_ready' AND (o.payment_status<>'paid' OR o.order_status<>'ready')) OR
      (n.event_type='order_completed' AND (o.payment_status<>'paid' OR o.order_status<>'completed')) OR
      (n.event_type='order_refunded' AND o.payment_status<>'refunded'))`, [settings.startAt]);
}

async function claimNotification(db, settings) {
  const result = await db.query(`WITH selected AS (
    SELECT n.id FROM order_notification_outbox n JOIN orders o ON o.id=n.order_id
    WHERE n.status IN ('pending','failed') AND n.retryable=TRUE AND n.attempts<5 AND n.next_attempt_at<=NOW()
      AND n.created_at>=$1::timestamptz
      AND (n.channel='email' OR (n.channel='sms' AND o.sms_opt_in=TRUE AND $2::boolean))
      AND (cardinality($3::text[])=0 OR LOWER(o.customer_email)=ANY($3::text[]))
      AND NOT EXISTS (SELECT 1 FROM order_notification_outbox prior
        WHERE prior.order_id=n.order_id AND prior.channel=n.channel AND prior.created_at>=$1::timestamptz
          AND prior.status NOT IN ('sent','skipped')
          AND (prior.created_at,${priority("prior")},prior.id)<(n.created_at,${priority("n")},n.id))
    ORDER BY n.created_at,${priority("n")},n.id FOR UPDATE OF n SKIP LOCKED LIMIT 1
  ) UPDATE order_notification_outbox n SET status='sending',attempts=n.attempts+1,
      claimed_at=NOW(),claim_token=gen_random_uuid(),last_error=NULL
    FROM selected WHERE n.id=selected.id
    RETURNING n.id,n.order_id,n.event_type,n.channel,n.attempts,n.claim_token`,
  [settings.startAt, settings.smsEnabled, settings.allowlist]);
  return result.rows[0] ?? null;
}

export async function processOrderNotificationBatch({ db = pool, send, max = 10, env = process.env, fetchImpl = fetch } = {}) {
  if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error("Invalid batch size");
  const settings = notificationSettings(env);
  if (!settings.enabled) return { disabled: true, processed: 0, sent: 0, failed: 0 };
  await prepareQueue(db, settings);
  const result = { disabled: false, processed: 0, sent: 0, failed: 0, uncertain: 0 };
  for (let i = 0; i < max; i++) {
    const job = await claimNotification(db, settings);
    if (!job) break;
    result.processed++;
    try {
      const detail = await db.query(`SELECT o.customer_email,o.customer_phone,o.shipping_name,o.sms_opt_in,
        o.total,o.fulfillment_at,o.fulfillment_method FROM orders o WHERE o.id=$1`, [job.order_id]);
      if (!detail.rowCount) throw new NotificationDeliveryError("Order not found", "permanent");
      const receipt = await (send ?? (row => sendOrderNotification(row, { settings, fetchImpl })))({ ...job, ...detail.rows[0] });
      const updated = await db.query(`UPDATE order_notification_outbox SET status='sent',sent_at=NOW(),claimed_at=NULL,
        provider_message_id=$3 WHERE id=$1 AND claim_token=$2 AND status='sending'`, [job.id, job.claim_token, receipt?.messageId ?? null]);
      if (updated.rowCount === 1) result.sent++;
    } catch (error) {
      const known = error instanceof NotificationDeliveryError;
      const kind = known ? error.kind : "uncertain";
      const reason = known ? error.message : "Notification outcome unknown; review provider logs before retrying";
      const status = kind === "uncertain" ? "uncertain" : "failed";
      await db.query(`UPDATE order_notification_outbox SET status=$3,retryable=$4,claimed_at=NULL,
        next_attempt_at=NOW()+($5*INTERVAL '1 minute'),last_error=$6
        WHERE id=$1 AND claim_token=$2 AND status='sending'`,
      [job.id, job.claim_token, status, kind === "retry", Math.min(60, 2 ** job.attempts), reason]);
      console.warn(`Order notification ${job.id}: ${status}`);
      result[status]++;
    }
  }
  return result;
}

export function startNotificationWorker({ run = processOrderNotificationBatch, everyMs = 60_000, env = process.env } = {}) {
  let settings;
  try { settings = notificationSettings(env); }
  catch (error) { console.warn(`Notification worker not started: ${error.message}`); return null; }
  if (!settings.enabled) return null;
  if (!Number.isInteger(everyMs) || everyMs < 100) throw new Error("Invalid notification worker interval");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await run({ env }); }
    catch { console.error("Notification worker could not process the queue; check database/configuration"); }
    finally { running = false; }
  };
  const interval = setInterval(tick, everyMs);
  interval.unref?.();
  void tick();
  return interval;
}
