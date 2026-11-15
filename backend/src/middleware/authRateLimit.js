import { createHmac } from "node:crypto";
import { pool } from "../config/database.js";

const WINDOW_SECONDS = 15 * 60;

// PostgreSQL counts attempts atomically across instances. There is no in-memory
// fallback: if protection cannot be checked, authentication fails closed.
export function createAuthRateLimit({ database = pool, action = "login" } = {}) {
  return async (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const email = typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase().slice(0, 254) : "";
    const secret = process.env.SESSION_SECRET;
    if (!secret) return res.status(503).json({ status: "ERROR", message: "Sign-in is temporarily unavailable" });
    const hash = (value) => createHmac("sha256", secret).update(value).digest("hex");
    const keys = [`${action}:ip:${hash(ip)}`, `${action}:identity:${hash(JSON.stringify([ip, email]))}`];
    const limits = action === "register" ? [10, 5] : [30, 10];
    try {
      const result = await database.query(`
        WITH cleanup AS (
          DELETE FROM public.auth_rate_limits WHERE key IN (
            SELECT key FROM public.auth_rate_limits
            WHERE expires_at <= NOW() AND NOT (key = ANY($1::text[]))
            ORDER BY expires_at LIMIT 100
          )
        )
        INSERT INTO public.auth_rate_limits AS current (key, attempts, expires_at)
        SELECT key, 1, NOW() + ($2 * INTERVAL '1 second')
        FROM unnest($1::text[]) AS keys(key) ORDER BY key
        ON CONFLICT (key) DO UPDATE SET
          attempts = CASE WHEN current.expires_at <= NOW() THEN 1
            ELSE LEAST(current.attempts + 1, 1000000) END,
          expires_at = CASE WHEN current.expires_at <= NOW()
            THEN NOW() + ($2 * INTERVAL '1 second') ELSE current.expires_at END
        RETURNING key, attempts, CEIL(EXTRACT(EPOCH FROM (expires_at - NOW())))::int AS retry_after
      `, [keys, WINDOW_SECONDS]);
      const blocked = result.rows.filter(row => row.attempts > limits[keys.indexOf(row.key)]);
      if (blocked.length) {
        res.set("Retry-After", String(Math.max(1, ...blocked.map(row => row.retry_after))));
        return res.status(429).json({ status: "ERROR", message: "Too many attempts. Please try again later." });
      }
      return next();
    } catch {
      console.error("Authentication rate-limit storage unavailable");
      return res.status(503).json({ status: "ERROR", message: "Sign-in is temporarily unavailable" });
    }
  };
}
