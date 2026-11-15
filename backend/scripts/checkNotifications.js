import { pool } from "../src/config/database.js";
import { notificationSettings } from "../src/services/orderNotifications.service.js";

try {
  let configuration;
  try {
    const settings = notificationSettings();
    configuration = { enabled: settings.enabled, startAt: settings.startAt ?? null,
      testRecipientCount: settings.allowlist?.length ?? 0, smsEnabled: settings.smsEnabled ?? false };
  } catch (error) { configuration = { enabled: true, configurationError: error.message }; }
  const counts = await pool.query(`SELECT channel,status,COUNT(*)::int AS count
    FROM order_notification_outbox GROUP BY channel,status ORDER BY channel,status`);
  console.log(JSON.stringify({ configuration, queue: counts.rows }, null, 2));
} catch (error) {
  console.error("Notification status check failed:", error.code ?? error.name);
  process.exitCode = 1;
} finally { await pool.end(); }
