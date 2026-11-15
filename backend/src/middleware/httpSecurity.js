import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { securityError } from "../utils/securityLog.js";

export function securityHeaders() {
  const hosted = process.env.NODE_ENV === "production";
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: hosted ? [] : null,
      },
    },
    strictTransportSecurity: hosted
      ? { maxAge: 31536000, includeSubDomains: false }
      : false,
    referrerPolicy: { policy: "no-referrer" },
    xFrameOptions: { action: "deny" },
    crossOriginEmbedderPolicy: false,
  });
}

export function requestBoundary(req, res, next) {
  req.requestId = randomUUID();
  res.set("X-Request-ID", req.requestId);
  res.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  try {
    const path = decodeURIComponent(req.path);
    if (
      /(?:^|\/)\.(?:env(?:\.|\/|$)|git(?:\/|$)|aws(?:\/|$)|codex(?:\/|$)|agents(?:\/|$))/.test(
        path,
      )
    )
      return res.status(404).json({ status: "ERROR", message: "Not found" });
  } catch {
    return res
      .status(400)
      .json({ status: "ERROR", message: "Invalid request path" });
  }
  next();
}

export function validateJsonBody(req, res, next) {
  if (req.body === undefined || !req.is("application/json")) return next();
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    return res
      .status(400)
      .json({ status: "ERROR", message: "A JSON object is required" });
  const pending = [[req.body, 0]];
  let nodes = 0;
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (++nodes > 5000 || depth > 16)
      return res
        .status(400)
        .json({ status: "ERROR", message: "Request structure is too complex" });
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        return res
          .status(400)
          .json({ status: "ERROR", message: "Unsupported request property" });
      if (child && typeof child === "object") pending.push([child, depth + 1]);
    }
  }
  next();
}

export function handleHttpError(error, req, res, _next) {
  const known = {
    "entity.parse.failed": [400, "Invalid JSON body"],
    "entity.too.large": [413, "Request body is too large"],
    "encoding.unsupported": [415, "Unsupported request encoding"],
    "charset.unsupported": [415, "Unsupported request encoding"],
  };
  const [status, message] =
    known[error.type] ||
    (error instanceof URIError
      ? [400, "Invalid request path"]
      : [500, "Internal server error"]);
  if (status === 500)
    securityError(error, "HTTP request failed", req.requestId);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res
    .status(status)
    .json({ status: "ERROR", message, request_id: req.requestId });
}
