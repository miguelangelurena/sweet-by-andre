import { createHmac } from "node:crypto";
import { consumeRateLimits } from "../services/rateLimitStore.js";
import { securityError } from "../utils/securityLog.js";

// These quotas protect hosted environments. Unit/integration tests exercise
// them explicitly; ordinary local development does not consume hosted quotas.
export function requestRateLimit({
  action,
  limit,
  identityLimit = limit,
  windowSeconds = 900,
  database,
  enabled = () => ["staging", "production"].includes(process.env.APP_ENV),
}) {
  return async (req, res, next) => {
    if (!enabled()) return next();
    try {
      if (!process.env.SESSION_SECRET)
        throw new Error("Missing rate-limit secret");
      const hash = (value) =>
        createHmac("sha256", process.env.SESSION_SECRET)
          .update(value)
          .digest("hex");
      const keys = [
        `request:${action}:ip:${hash(req.ip || req.socket?.remoteAddress || "unknown")}`,
      ];
      const identity = req.user?.id || req.cartId;
      if (identity) keys.push(`request:${action}:identity:${hash(identity)}`);
      const rows = await consumeRateLimits(keys, windowSeconds, database);
      const blocked = rows.filter(
        (row) => row.attempts > (row.key === keys[0] ? limit : identityLimit),
      );
      if (blocked.length) {
        res.set(
          "Retry-After",
          String(Math.max(1, ...blocked.map((row) => row.retry_after))),
        );
        return res
          .status(429)
          .json({
            status: "ERROR",
            code: "RATE_LIMITED",
            message: "Too many requests. Please try again later.",
          });
      }
      next();
    } catch (error) {
      securityError(error, "Request quota unavailable", req.requestId);
      res
        .status(503)
        .json({
          status: "ERROR",
          message: "This operation is temporarily unavailable",
        });
    }
  };
}
