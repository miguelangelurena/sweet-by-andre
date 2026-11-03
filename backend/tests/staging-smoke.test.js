import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { databaseOptions } from "../src/config/hosting.js";

test(
  "fresh staging supports HTTPS admin sessions and preserves edits on redeployment without local data",
  { timeout: 45000 },
  async () => {
    // This test creates and drops only its own uniquely named local database.
    if (
      process.env.DATABASE_URL ||
      !["localhost", "127.0.0.1", "::1"].includes(process.env.DB_HOST)
    )
      throw new Error(
        "Staging smoke test requires local DB_* settings and permission to create a temporary database",
      );
    const name = `sweet_by_andre_staging_smoke_${randomBytes(4).toString("hex")}`;
    const management = new Pool(
      databaseOptions({ ...process.env, DB_NAME: "postgres" }),
    );
    const url = new URL("postgresql://localhost");
    url.hostname = process.env.DB_HOST;
    url.port = process.env.DB_PORT;
    url.username = process.env.DB_USER;
    url.password = process.env.DB_PASSWORD;
    url.pathname = `/${name}`;
    const password = randomBytes(20).toString("hex");
    const env = {
      ...process.env,
      DATABASE_URL: url.href,
      DB_NAME: name,
      APP_ENV: "staging",
      NODE_ENV: "production",
      SERVE_FRONTEND: "true",
      FRONTEND_URL: "",
      RENDER_EXTERNAL_URL: "https://preview.onrender.com",
      RAILWAY_PUBLIC_DOMAIN: "",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      CLOUDINARY_CLOUD_NAME: "",
      CLOUDINARY_API_KEY: "",
      CLOUDINARY_API_SECRET: "",
      GOOGLE_ROUTES_API_KEY: "",
      ENABLE_STRIPE_CHECKOUT: "false",
      ENABLE_TRANSACTIONAL_NOTIFICATIONS: "false",
      ENABLE_TRANSACTIONAL_SMS: "false",
      SESSION_SECRET: randomBytes(32).toString("hex"),
      CSRF_SECRET: randomBytes(32).toString("hex"),
      STAGING_ADMIN_EMAIL: "staging-smoke@example.com",
      STAGING_ADMIN_PASSWORD: password,
    };
    const cwd = fileURLToPath(new URL("../", import.meta.url));
    let created = false,
      app,
      staging;
    const setup = () => {
      const result = spawnSync(
        process.execPath,
        ["scripts/initializeStaging.js"],
        { cwd, env, encoding: "utf8", timeout: 20000 },
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
    };
    try {
      await management.query(`CREATE DATABASE "${name}"`);
      created = true;
      setup();
      staging = new Pool({ connectionString: url.href });
      assert.equal((await staging.query(`SELECT COUNT(*)::int AS count FROM information_schema.columns
        WHERE table_schema='public' AND table_name='refund_requests'
        AND column_name IN ('requested_by','reason','resources_returned_at')`)).rows[0].count, 3);
      assert.equal(
        (await staging.query("SELECT COUNT(*)::int AS count FROM users"))
          .rows[0].count,
        1,
      );
      for (const table of [
        "orders",
        "payments",
        "session",
        "cart",
        "addresses",
        "production_reservations",
      ])
        assert.equal(
          (await staging.query(`SELECT COUNT(*)::int AS count FROM ${table}`))
            .rows[0].count,
          0,
          `${table} should start empty`,
        );
      const seeded = (
        await staging.query("SELECT id,name FROM products ORDER BY id LIMIT 1")
      ).rows[0];
      assert.ok(seeded);
      assert.equal(
        (
          await staging.query(
            "SELECT COUNT(*)::int AS count FROM product_images WHERE cloudinary_public_id IS NOT NULL",
          )
        ).rows[0].count,
        0,
      );
      const failedStart = spawnSync(process.execPath, ["scripts/startStaging.js"], {
        cwd,
        env: { ...env, SESSION_SECRET: "" },
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(failedStart.status, 1);
      assert.match(failedStart.stderr, /SESSION_SECRET/);
      assert.ok(!failedStart.stdout.includes("Server listening"));

      // Run the same command used by Render, with its HTTPS public origin.
      const probe = createServer();
      await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
      const availablePort = probe.address().port;
      await new Promise((resolve) => probe.close(resolve));
      app = spawn(
        process.execPath,
        ["scripts/startStaging.js"],
        {
          cwd,
          env: { ...env, PORT: String(availablePort) },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const port = await new Promise((resolve, reject) => {
        let output = "",
          errors = "";
        const timer = setTimeout(
          () => reject(new Error(`Staging server failed to start: ${errors}`)),
          10000,
        );
        app.stderr.on("data", (chunk) => {
          errors += String(chunk);
        });
        app.stdout.on("data", (chunk) => {
          output += String(chunk);
          const match = output.match(/Server listening on port: (\d+)/);
          if (match) {
            clearTimeout(timer);
            resolve(Number(match[1]));
          }
        });
        app.on("exit", () => {
          clearTimeout(timer);
          reject(new Error(`Staging exited before readiness: ${errors}`));
        });
      });
      const origin = `http://127.0.0.1:${port}`;
      const call = (path, options = {}, cookie = "") =>
        fetch(`${origin}${path}`, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            Origin: env.RENDER_EXTERNAL_URL,
            "X-Forwarded-Proto": "https",
            ...(cookie ? { Cookie: cookie } : {}),
            ...options.headers,
          },
        });
      const home = await call("/");
      assert.equal(home.status, 200);
      assert.ok((await home.text()).includes('id="root"'));
      assert.equal(home.headers.get("x-robots-tag"), "noindex, nofollow");
      assert.deepEqual(await (await call("/api/health")).json(), {
        status: "OK",
      });
      assert.equal((await call("/payment-success")).status, 200);
      const missing = await call("/api/missing");
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).status, "ERROR");
      assert.equal((await call("/api/admin/production")).status, 401);
      const login = await call("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: env.STAGING_ADMIN_EMAIL, password }),
      });
      assert.equal(login.status, 200);
      const setCookie = login.headers.get("set-cookie");
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /Secure/);
      assert.match(setCookie, /SameSite=Lax/);
      const cookie = setCookie.split(";")[0];
      const admin = await call("/api/admin/production", {}, cookie);
      assert.equal(admin.status, 200);
      const data = await admin.json();
      const token = (
        await (await call("/api/cart/csrf-token", {}, cookie)).json()
      ).csrf_token;
      const payload = {
        version: data.settings.version,
        config: { ...data.settings.config, daily_capacity: 8 },
      };
      assert.equal(
        (
          await call(
            "/api/admin/production",
            { method: "PUT", body: JSON.stringify(payload) },
            cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await call(
            "/api/admin/production",
            {
              method: "PUT",
              headers: { "X-CSRF-Token": token },
              body: JSON.stringify(payload),
            },
            cookie,
          )
        ).status,
        200,
      );
      await staging.query("UPDATE products SET name=$2 WHERE id=$1", [
        seeded.id,
        "Owner preview edit",
      ]);
      env.STAGING_ADMIN_PASSWORD = randomBytes(20).toString("hex");
      setup();
      assert.equal(
        (
          await staging.query(
            "SELECT config FROM production_settings WHERE id=TRUE",
          )
        ).rows[0].config.daily_capacity,
        8,
      );
      assert.equal(
        (
          await staging.query("SELECT name FROM products WHERE id=$1", [
            seeded.id,
          ])
        ).rows[0].name,
        "Owner preview edit",
      );
      assert.equal(
        (await staging.query("SELECT COUNT(*)::int AS count FROM users"))
          .rows[0].count,
        1,
      );
      assert.equal(
        (
          await call("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email: env.STAGING_ADMIN_EMAIL, password }),
          })
        ).status,
        200,
        "redeployment must not reset the owner's password",
      );
    } finally {
      if (app && app.exitCode === null) {
        const exited = new Promise((resolve) => app.once("exit", resolve));
        app.kill();
        await exited;
      }
      await staging?.end();
      if (created && /^sweet_by_andre_staging_smoke_[0-9a-f]{8}$/.test(name))
        await management.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await management.end();
    }
  },
);
