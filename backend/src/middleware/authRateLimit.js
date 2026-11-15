import { consumeRateLimits } from "../services/rateLimitStore.js";
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
      const result = { rows: await consumeRateLimits(keys, WINDOW_SECONDS, database) };
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
