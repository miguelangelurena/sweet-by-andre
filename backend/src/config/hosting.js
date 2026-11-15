export function frontendOrigins(env = process.env) {
  const configured =
    env.FRONTEND_URL ||
    env.RENDER_EXTERNAL_URL ||
    (env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:5173");
  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function databaseOptions(env = process.env) {
  const options = env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL }
    : {
        host: env.DB_HOST,
        port: Number(env.DB_PORT),
        database: env.DB_NAME,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
      };
  if (env.DB_SSL === "true") options.ssl = { rejectUnauthorized: true };
  return { ...options, connectionTimeoutMillis: 10000 };
}

export function stripeSecret(env = process.env) {
  if (env.APP_ENV === "production") {
    if (env.ENABLE_STRIPE_CHECKOUT !== "false")
      throw new Error("Production checkout remains disabled until the live-payment rollout is validated");
    if (env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.startsWith("sk_live_"))
      throw new Error("Production refuses Stripe test keys");
    return env.STRIPE_SECRET_KEY || "sk_test_disabled_production";
  }
  if (
    env.APP_ENV === "staging" &&
    env.STRIPE_SECRET_KEY &&
    !env.STRIPE_SECRET_KEY.startsWith("sk_test_")
  ) {
    throw new Error("Staging requires a Stripe test key");
  }
  if (env.STRIPE_SECRET_KEY) return env.STRIPE_SECRET_KEY;
  if (env.APP_ENV === "staging" && env.ENABLE_STRIPE_CHECKOUT !== "true")
    return "sk_test_disabled_staging";
  throw new Error("STRIPE_SECRET_KEY is not configured");
}

export function validateProductionRuntime(env = process.env) {
  if (env.APP_ENV !== "production" || env.NODE_ENV !== "production")
    throw new Error("Production requires APP_ENV=production and NODE_ENV=production");
  if (env.SERVE_FRONTEND !== "true") throw new Error("Production requires SERVE_FRONTEND=true");
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32)
    throw new Error("Set a production SESSION_SECRET with at least 32 characters");
  if (!/^[a-f0-9]{64}$/i.test(env.CSRF_SECRET ?? ""))
    throw new Error("Set a production CSRF_SECRET with 64 hexadecimal characters");
  if (!env.PRODUCTION_DB_NAME?.trim()) throw new Error("Set PRODUCTION_DB_NAME to the separate production database name");
  if (!env.FRONTEND_URL || frontendOrigins(env).length !== 1)
    throw new Error("Set exactly one explicit HTTPS FRONTEND_URL for production");
  try {
    const url = new URL(env.FRONTEND_URL);
    if (url.protocol !== "https:" || url.origin !== env.FRONTEND_URL || url.username || url.password)
      throw new Error();
  } catch { throw new Error("Set exactly one explicit HTTPS FRONTEND_URL for production"); }
  // This deployment stage is a closed preparation environment, not live launch.
  for (const flag of ["ENABLE_STRIPE_CHECKOUT", "ENABLE_ADMIN_REFUNDS", "ENABLE_TRANSACTIONAL_NOTIFICATIONS", "ENABLE_TRANSACTIONAL_SMS"])
    if (env[flag] !== "false") throw new Error(`${flag} must remain explicitly false during production preparation`);
  stripeSecret(env);
}

export function validateStagingRuntime(env = process.env) {
  if (env.APP_ENV !== "staging")
    throw new Error("Staging setup requires APP_ENV=staging");
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32)
    throw new Error("Set a staging SESSION_SECRET with at least 32 characters");
  if (!/^[a-f0-9]{64}$/i.test(env.CSRF_SECRET ?? ""))
    throw new Error("Set a staging CSRF_SECRET with 64 hexadecimal characters");
  const origins = frontendOrigins(env);
  if (
    origins.some((origin) => {
      try {
        const url = new URL(origin);
        return url.protocol !== "https:" || url.origin !== origin;
      } catch {
        return true;
      }
    })
  )
    throw new Error(
      "Set an HTTPS FRONTEND_URL or use the public URL provided by Render or Railway",
    );
  stripeSecret(env);
  if (
    env.ENABLE_STRIPE_CHECKOUT === "true" &&
    !/^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET ?? "")
  )
    throw new Error(
      "Set the staging STRIPE_WEBHOOK_SECRET before enabling checkout",
    );
}
