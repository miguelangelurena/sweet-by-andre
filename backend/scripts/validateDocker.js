import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// No dotenv: only generated fixture credentials enter these containers.
const root = fileURLToPath(new URL("../../", import.meta.url));
const prefix = `sba-validation-${randomBytes(5).toString("hex")}`;
const network = `${prefix}-network`, postgres = `${prefix}-db`;
const containers = [];
let networkCreated = false;

async function docker(args, { env = {}, visible = false, captureErrors = false, input, timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd: root, env: { ...process.env, ...env }, shell: false, windowsHide: true,
      stdio: ["pipe", visible ? "inherit" : "pipe", "pipe"] });
    let output = "";
    if (!visible) child.stdout.on("data", chunk => { output += chunk.toString(); });
    // Never print raw diagnostics that might contain configuration values.
    if (captureErrors) child.stderr.on("data", chunk => { output += chunk.toString(); });
    else child.stderr.resume();
    const timer = setTimeout(() => child.kill(), timeout);
    child.once("error", () => { clearTimeout(timer); reject(new Error("Docker could not start; check Docker Desktop")); });
    child.once("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`Docker ${args[0]} failed; inspect the local validation resources`));
    });
    child.stdin.end(input);
  });
}

async function ready(check, label) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    try { const result = await check(); if (result) return result; } catch { /* Startup in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error(`${label} did not become ready within 60 seconds`);
}

async function validateMode(mode) {
  const image = `sweet-by-andre:validation-${mode}`;
  console.log(`Building ${mode} image (no service credentials in build arguments)...`);
  await docker(["build", "--build-arg", `APP_ENV=${mode}`, "--build-arg", `ENABLE_STRIPE_CHECKOUT=${mode === "staging" ? "true" : "false"}`, "--tag", image, "."], { visible: true });
  const database = mode === "staging" ? "bakery_stage_validation" : "bakery_live_validation";
  await docker(["exec", "-i", postgres, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], { input: `CREATE DATABASE ${database};\n` });
  const password = randomBytes(24).toString("hex");
  const email = `${mode}@example.com`;
  const env = {
    APP_ENV: mode, NODE_ENV: "production", SERVE_FRONTEND: "true", PORT: "5000",
    DB_HOST: "database", DB_PORT: "5432", DB_NAME: database, DB_USER: "postgres", DB_PASSWORD: process.env.DOCKER_VALIDATION_PG_PASSWORD,
    SESSION_SECRET: randomBytes(32).toString("hex"), CSRF_SECRET: randomBytes(32).toString("hex"),
    FRONTEND_URL: "https://validation.example", ENABLE_STRIPE_CHECKOUT: "false", ENABLE_ADMIN_REFUNDS: "false",
    ENABLE_TRANSACTIONAL_NOTIFICATIONS: "false", ENABLE_TRANSACTIONAL_SMS: "false", SITE_INDEXABLE: "false",
    ...(mode === "staging" ? { STAGING_ADMIN_EMAIL: email, STAGING_ADMIN_PASSWORD: password }
      : { PRODUCTION_DB_NAME: database, PRODUCTION_ADMIN_EMAIL: email, PRODUCTION_ADMIN_PASSWORD: password,
        PRODUCTION_ADMIN_FIRST_NAME: "Docker", PRODUCTION_ADMIN_LAST_NAME: "Fixture" }),
  };
  const name = `${prefix}-${mode}`;
  await docker(["run", "--detach", "--name", name, "--network", network, "--publish", "127.0.0.1::5000",
    ...Object.keys(env).flatMap(key => ["--env", key]), image], { env });
  containers.push(name);
  try {
  const mapping = await docker(["port", name, "5000/tcp"]);
  const port = mapping.match(/127\.0\.0\.1:(\d+)/)?.[1];
  assert.ok(port, "validation HTTP port must be bound to loopback only");
  let origin = `http://127.0.0.1:${port}`;
  const call = (path, options = {}, cookie = "") => fetch(`${origin}${path}`, {
    ...options, signal: AbortSignal.timeout(5000), headers: { "Content-Type": "application/json",
      Origin: env.FRONTEND_URL, "X-Forwarded-Proto": "https", ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
  });
  await ready(async () => (await call("/api/health")).ok, `${mode} application`);
  assert.deepEqual(await (await call("/api/health")).json(), { status: "OK" });
  const home = await call("/"); assert.equal(home.status, 200, `${mode} home`);
  assert.equal(home.headers.get("x-robots-tag"), "noindex, nofollow");
  const html = await home.text();
  const script = html.match(/src="([^"]+\.js)"/)?.[1]; assert.ok(script);
  const bundle = await (await call(script)).text();
  assert.ok(bundle.includes("Sign out"));
  assert.equal(bundle.includes("Preview environment"), mode === "staging");
  assert.equal((await call("/api/admin/products")).status, 401);
  const login = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200, `${mode} login`);
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Lax/);
  const cookie = setCookie.split(";")[0];
  const catalog = await (await call("/api/admin/products", {}, cookie)).json();
  assert.equal(catalog.products.length > 0, mode === "staging");
  const payload = JSON.stringify({ name: "Docker validation category" });
  assert.equal((await call("/api/categories", { method: "POST", body: payload }, cookie)).status, 403);
  const token = (await (await call("/api/cart/csrf-token", {}, cookie)).json()).csrf_token;
  const category = await call("/api/categories", { method: "POST", headers: { "X-CSRF-Token": token }, body: payload }, cookie);
  assert.equal(category.status, 201);
  await docker(["restart", name]);
  // Docker may reassign an automatically published host port on restart.
  const restartedMapping = await docker(["port", name, "5000/tcp"]);
  const restartedPort = restartedMapping.match(/127\.0\.0\.1:(\d+)/)?.[1];
  assert.ok(restartedPort);
  origin = `http://127.0.0.1:${restartedPort}`;
  await ready(async () => (await call("/api/health")).ok, `${mode} restart`);
  const categories = await (await call("/api/admin/categories", {}, cookie)).json();
  assert.ok(categories.categories.some(row => row.name === "Docker validation category"));
  const logout = await call("/api/auth/logout", { method: "POST" }, cookie);
  assert.equal(logout.status, 200, `${mode} logout`);
  assert.equal((await call("/api/admin/products", {}, cookie)).status, 401);
  console.log(`${mode}: image build, isolated initialization, frontend, secure cookies, CSRF, restart persistence and logout passed.`);
  } catch (error) {
    let logs = await docker(["logs", name], { captureErrors: true }).catch(() => "Container diagnostics unavailable");
    for (const [key, value] of Object.entries(env))
      if (/PASSWORD|SECRET/.test(key) && value) logs = logs.split(value).join("[redacted]");
    console.error(logs.slice(-6000));
    throw error;
  }
}

try {
  await docker(["version", "--format", "{{.Server.Version}}"]);
  await docker(["network", "create", network]); networkCreated = true;
  const password = randomBytes(32).toString("hex");
  process.env.DOCKER_VALIDATION_PG_PASSWORD = password;
  console.log("Starting disposable PostgreSQL 18 (no published database port)...");
  await docker(["run", "--detach", "--name", postgres, "--network", network, "--network-alias", "database",
    "--env", "POSTGRES_PASSWORD", "postgres:18"], { env: { POSTGRES_PASSWORD: password } });
  containers.push(postgres);
  await ready(async () => { await docker(["exec", postgres, "pg_isready", "-U", "postgres"], { timeout: 5000 }); return true; }, "PostgreSQL");
  await validateMode("staging");
  await validateMode("production");
  console.log("Both hosted modes passed Docker validation. No hosted database, real payment or customer notification was used.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  for (const name of containers.reverse()) {
    if (name.startsWith(`${prefix}-`)) {
      try { await docker(["rm", "--force", "--volumes", name]); }
      catch { console.error(`Could not remove validation container ${name}`); process.exitCode = 1; }
    }
  }
  if (networkCreated) {
    try { await docker(["network", "rm", network]); }
    catch { console.error(`Could not remove validation network ${network}`); process.exitCode = 1; }
  }
  delete process.env.DOCKER_VALIDATION_PG_PASSWORD;
}
