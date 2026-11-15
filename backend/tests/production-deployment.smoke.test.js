import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { databaseOptions } from "../src/config/hosting.js";

test("closed production initializes without demos, preserves edits and serves HTTPS admin sessions", { timeout: 60000 }, async t => {
  if (process.env.DATABASE_URL || !["localhost", "127.0.0.1", "::1"].includes(process.env.DB_HOST))
    throw new Error("Deployment smoke test requires local DB_* settings and CREATE DATABASE permission");
  const name = `sweet_by_andre_deploy_smoke_${randomBytes(4).toString("hex")}`;
  const management = new Pool(databaseOptions({ ...process.env, DB_NAME: "postgres" }));
  const url = new URL("postgresql://localhost");
  url.hostname = process.env.DB_HOST; url.port = process.env.DB_PORT;
  url.username = process.env.DB_USER; url.password = process.env.DB_PASSWORD; url.pathname = `/${name}`;
  const password = randomBytes(20).toString("hex");
  const env = {
    ...process.env, DATABASE_URL: url.href, PRODUCTION_DB_NAME: name,
    APP_ENV: "production", NODE_ENV: "production", SERVE_FRONTEND: "true",
    FRONTEND_URL: "https://bakery.example", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "",
    ENABLE_STRIPE_CHECKOUT: "false", ENABLE_ADMIN_REFUNDS: "false",
    ENABLE_TRANSACTIONAL_NOTIFICATIONS: "false", ENABLE_TRANSACTIONAL_SMS: "false",
    BREVO_API_KEY: "", BREVO_SENDER_EMAIL: "", CLOUDINARY_CLOUD_NAME: "", CLOUDINARY_API_KEY: "", CLOUDINARY_API_SECRET: "",
    GOOGLE_ROUTES_API_KEY: "", SITE_INDEXABLE: "false",
    SESSION_SECRET: randomBytes(32).toString("hex"), CSRF_SECRET: randomBytes(32).toString("hex"),
    PRODUCTION_ADMIN_EMAIL: "production-smoke@example.com", PRODUCTION_ADMIN_PASSWORD: password,
    PRODUCTION_ADMIN_FIRST_NAME: "Bakery", PRODUCTION_ADMIN_LAST_NAME: "Test", PRODUCTION_ADMIN_PHONE: "",
  };
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const command = (script, changes = {}) => spawnSync(process.execPath, [script], {
    cwd, env: { ...env, ...changes }, encoding: "utf8", timeout: 20000, windowsHide: true,
  });
  const setup = (changes = {}) => command("scripts/initializeProduction.js", changes);
  let created = false, database, app;
  try {
    await management.query(`CREATE DATABASE "${name}"`); created = true;
    database = new Pool({ connectionString: url.href });
    await t.test("missing first administrator credentials leave the database empty", async () => {
      assert.equal(setup({ PRODUCTION_ADMIN_PASSWORD: "" }).status, 1);
      assert.equal((await database.query("SELECT COUNT(*)::int AS count FROM pg_tables WHERE schemaname='public'")).rows[0].count, 0);
    });
    await t.test("an unmarked nonempty database is never adopted or overwritten", async () => {
      await database.query("CREATE TABLE public.sentinel (value TEXT)");
      await database.query("INSERT INTO public.sentinel VALUES ('preserve')");
      assert.equal(setup().status, 1);
      assert.equal((await database.query("SELECT value FROM public.sentinel")).rows[0].value, "preserve");
      // This fixture was created in this test's own disposable database.
      await database.query("DROP TABLE public.sentinel");
    });
    const first = setup(); assert.equal(first.status, 0, first.stderr || first.stdout);
    for (const table of ["categories", "products", "orders", "payments", "cart", "session", "order_notification_outbox"])
      assert.equal((await database.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count, 0, `${table} must start empty`);
    assert.equal((await database.query("SELECT COUNT(*)::int AS count FROM users WHERE role='admin'")).rows[0].count, 1);
    const migrations = (await database.query("SELECT name,checksum,applied_at FROM deployment_migrations ORDER BY name")).rows;
    assert.equal(migrations.length, 5);
    assert.equal((await database.query("SELECT config FROM production_settings")).rows[0].config.weekly_capacity.every(day => !day.enabled), true);
    assert.equal((await database.query("SELECT config FROM delivery_settings")).rows[0].config.delivery_enabled, false);

    await t.test("staging markers and altered migration checksums block startup", async () => {
      await database.query("UPDATE deployment_metadata SET value='staging' WHERE key='environment'");
      const failed = command("scripts/startHosted.js");
      assert.equal(failed.status, 1); assert.ok(!failed.stdout.includes("Server listening"));
      await database.query("UPDATE deployment_metadata SET value='production' WHERE key='environment'");
      await database.query("UPDATE deployment_migrations SET checksum='altered' WHERE name=$1", [migrations[0].name]);
      assert.equal(setup().status, 1);
      await database.query("UPDATE deployment_migrations SET checksum=$2 WHERE name=$1", [migrations[0].name, migrations[0].checksum]);
      assert.equal(command("scripts/startProduction.js", { ENABLE_STRIPE_CHECKOUT: "true" }).status, 1);
      assert.equal(setup({ PRODUCTION_DB_NAME: "different_database" }).status, 1);
    });
    const category = (await database.query("INSERT INTO categories (name) VALUES ('Approved fixture') RETURNING id")).rows[0].id;
    const product = (await database.query("INSERT INTO products (name,price,stock,category_id) VALUES ('Owner edit',6.99,2,$1) RETURNING id", [category])).rows[0].id;
    assert.equal(setup({ PRODUCTION_ADMIN_PASSWORD: "replacement-not-applied" }).status, 0);
    assert.equal((await database.query("SELECT name FROM products WHERE id=$1", [product])).rows[0].name, "Owner edit");
    assert.deepEqual((await database.query("SELECT name,checksum,applied_at FROM deployment_migrations ORDER BY name")).rows, migrations);

    const probe = createServer();
    await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    app = spawn(process.execPath, ["scripts/startHosted.js"], { cwd, env: { ...env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Production server did not become ready")), 10000);
      app.stdout.on("data", chunk => { output += String(chunk); if (output.includes("Server listening on port:")) { clearTimeout(timer); resolve(); } });
      app.stderr.resume();
      app.once("exit", () => { clearTimeout(timer); reject(new Error("Production server exited before readiness")); });
    });
    const call = (path, options = {}, cookie = "") => fetch(`http://127.0.0.1:${port}${path}`, {
      ...options, headers: { "Content-Type": "application/json", Origin: env.FRONTEND_URL,
        "X-Forwarded-Proto": "https", ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
    });
    const home = await call("/"); assert.equal(home.status, 200);
    assert.equal(home.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.ok((await home.text()).includes('id="root"'));
    assert.deepEqual(await (await call("/api/health")).json(), { status: "OK" });
    assert.equal((await call("/api/admin/products")).status, 401);
    assert.equal((await call("/api/auth/login", { method: "POST", headers: { Origin: "https://other.example" }, body: JSON.stringify({ email: env.PRODUCTION_ADMIN_EMAIL, password }) })).status, 403);
    const login = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email: env.PRODUCTION_ADMIN_EMAIL, password }) });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get("cache-control"), "no-store");
    const cookieHeader = login.headers.get("set-cookie");
    assert.match(cookieHeader, /Secure/); assert.match(cookieHeader, /HttpOnly/); assert.match(cookieHeader, /SameSite=Lax/);
    const cookie = cookieHeader.split(";")[0];
    assert.equal((await call("/api/admin/products", {}, cookie)).status, 200);
    assert.equal((await call(`/api/products/${product}/availability`, { method: "PATCH", body: JSON.stringify({ is_available: false }) }, cookie)).status, 403);
    const token = (await (await call("/api/cart/csrf-token", {}, cookie)).json()).csrf_token;
    assert.equal((await call(`/api/products/${product}/availability`, { method: "PATCH", headers: { "X-CSRF-Token": token }, body: JSON.stringify({ is_available: false }) }, cookie)).status, 200);
    assert.equal((await database.query("SELECT COUNT(*)::int AS count FROM users")).rows[0].count, 1);
    assert.equal((await database.query("SELECT COUNT(*)::int AS count FROM payments")).rows[0].count, 0);
  } finally {
    if (app && app.exitCode === null) { const exited = new Promise(resolve => app.once("exit", resolve)); app.kill(); await exited; }
    await database?.end();
    try {
      if (created && /^sweet_by_andre_deploy_smoke_[0-9a-f]{8}$/.test(name)) await management.query(`DROP DATABASE "${name}"`);
    } finally { await management.end(); }
  }
});
