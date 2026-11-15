import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import { requireTestDatabase } from "./helpers/requireTestDatabase.js";
import { createAuthRateLimit } from "../src/middleware/authRateLimit.js";

after(() => pool.end());

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("authentication throttles persist, handle concurrency and recover after expiry", async () => {
  await requireTestDatabase(pool);
  const ip = `test-${randomUUID()}`;
  const otherIp = `test-${randomUUID()}`;
  const email = `${randomUUID()}@example.com`;
  const hash = value => createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("hex");
  const keys = [
    `login:ip:${hash(ip)}`, `login:identity:${hash(JSON.stringify([ip, email]))}`,
    `login:ip:${hash(otherIp)}`, `login:identity:${hash(JSON.stringify([otherIp, email]))}`,
  ];
  const invoke = async (limiter, address = ip, account = email) => {
    const res = response();
    await limiter({ ip: address, body: { email: account } }, res, () => { res.passed = true; });
    return res;
  };
  try {
    const limiter = createAuthRateLimit();
    const attempts = await Promise.all(Array.from({ length: 12 }, () => invoke(limiter)));
    assert.equal(attempts.filter(res => res.passed).length, 10);
    assert.equal(attempts.filter(res => res.statusCode === 429).length, 2);
    assert.ok(Number(attempts.find(res => res.statusCode === 429).headers["Retry-After"]) > 0);
    assert.equal((await invoke(createAuthRateLimit(), ip, ` ${email.toUpperCase()} `)).statusCode, 429,
      "new middleware and email casing cannot bypass stored limits");
    assert.equal((await invoke(limiter, otherIp)).passed, true, "a different IP remains usable");
    await pool.query("UPDATE public.auth_rate_limits SET expires_at=NOW()-INTERVAL '1 second' WHERE key=ANY($1::text[])", [keys]);
    assert.equal((await invoke(limiter)).passed, true);
    assert.equal((await pool.query("SELECT attempts FROM public.auth_rate_limits WHERE key=$1", [keys[0]])).rows[0].attempts, 1);

    // Rotating email addresses must still hit the independent IP limit.
    for (let index = 0; index < 30; index++) {
      const account = `${index}-${randomUUID()}@example.com`;
      keys.push(`login:identity:${hash(JSON.stringify([ip, account]))}`);
      const result = await invoke(limiter, ip, account);
      assert.equal(result.statusCode, index < 29 ? 200 : 429);
    }
  } finally {
    await pool.query("DELETE FROM public.auth_rate_limits WHERE key=ANY($1::text[])", [keys]);
  }
});

test("authentication fails closed if the throttle store is unavailable", async t => {
  t.mock.method(console, "error", () => {});
  const limiter = createAuthRateLimit({ database: { query: async () => { throw new Error("unavailable"); } } });
  const res = response();
  await limiter({ ip: "local", body: { email: "test@example.com" } }, res, () => assert.fail("authentication must not continue"));
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.stringify(res.body).includes("unavailable"), true);
  assert.equal(JSON.stringify(res.body).includes("test@example.com"), false);
});

test("admin access rechecks roles, rotates sessions, and protects every catalog mutation", async () => {
  await requireTestDatabase(pool);
  const email = `security-${randomUUID()}@example.com`;
  const password = "SecurityValidationPassword123!";
  const agent = request.agent(app);
  let userId, categoryId, productId, variantId;
  try {
    for (const invalid of [null, 123, { password: "invalid" }]) {
      await request(app).post("/api/auth/login").send({ email, password: invalid }).expect(400);
    }
    await request(app).post("/api/auth/login").send({ email: { value: email }, password }).expect(400);
    await request(app).post("/api/auth/login").send({ email, password: "é".repeat(37) }).expect(400);
    for (const invalidPassword of ["short", { value: password }]) {
      await request(app).post("/api/auth/register").send({ firstName: "Security", lastName: "Test", phone: "5551234567", email, password: invalidPassword }).expect(400);
    }
    const registration = await agent.post("/api/auth/register").send({ firstName: "Security", lastName: "Test", phone: "5551234567", email, password, role: "admin" }).expect(201);
    userId = registration.body.user.id;
    assert.equal(registration.body.user.role, "customer", "registration cannot choose an administrator role");
    const firstLogin = await agent.post("/api/auth/login").send({ email, password }).expect(200);
    const oldCookie = firstLogin.headers["set-cookie"][0].split(";")[0];
    const secondLogin = await agent.post("/api/auth/login").send({ email, password }).expect(200);
    assert.notEqual(secondLogin.headers["set-cookie"][0].split(";")[0], oldCookie);
    await request(app).get("/api/auth/me").set("Cookie", oldCookie).expect(401);
    await agent.get("/api/admin/products").expect(403);
    await agent.post("/api/products").send({}).expect(403);
    await pool.query("UPDATE users SET role='admin' WHERE id=$1", [userId]);
    await agent.get("/api/admin/products").expect(200);

    const id = randomUUID();
    const paths = [
      ["post", "/api/products"], ["patch", `/api/products/${id}`],
      ["patch", `/api/products/${id}/availability`],
      ["post", `/api/admin/product-options/${id}/values`],
      ["post", `/api/admin/products/${id}/variants`],
      ["patch", `/api/admin/variants/${id}`],
      ["patch", `/api/admin/product-options/${id}`],
      ["patch", `/api/admin/product-option-values/${id}`],
      ["post", `/api/admin/products/${id}/options`],
      ["post", `/api/products/${id}/images`],
      ["post", `/api/products/${id}/images/upload`],
      ["patch", `/api/products/${id}/images/${id}`],
      ["delete", `/api/products/${id}/images/${id}`],
    ];
    for (const [method, path] of paths) {
      await request(app)[method](path).send({}).expect(401);
      await agent[method](path).send({}).expect(403);
      await agent[method](path).set("X-CSRF-Token", "0".repeat(64)).send({}).expect(403);
    }
    const token = (await agent.get("/api/cart/csrf-token").expect(200)).body.csrf_token;
    categoryId = (await pool.query("INSERT INTO categories (name) VALUES ($1) RETURNING id", [`Security ${randomUUID()}`])).rows[0].id;
    productId = (await pool.query("INSERT INTO products (name,price,stock,category_id) VALUES ('Security fixture',5,2,$1) RETURNING id", [categoryId])).rows[0].id;
    variantId = (await pool.query("INSERT INTO product_variants (product_id,price,stock) VALUES ($1,5,2) RETURNING id", [productId])).rows[0].id;
    await agent.patch(`/api/products/${productId}/availability`).set("X-CSRF-Token", token).send({ is_available: false }).expect(200);
    await agent.patch(`/api/admin/variants/${variantId}`).set("X-CSRF-Token", token).send({ price: 7, stock: 3, is_available: true }).expect(200);
    assert.equal(Number((await pool.query("SELECT price FROM product_variants WHERE id=$1", [variantId])).rows[0].price), 7);
    await agent.post(`/api/products/${productId}/images/upload`).set("X-CSRF-Token", token).expect(400);
    await pool.query("UPDATE users SET role='customer' WHERE id=$1", [userId]);
    await agent.get("/api/admin/products").expect(403);
    await pool.query("UPDATE users SET deleted_at=NOW() WHERE id=$1", [userId]);
    await agent.get("/api/auth/me").expect(401);
  } finally {
    await agent.post("/api/auth/logout");
    if (variantId) await pool.query("DELETE FROM product_variants WHERE id=$1", [variantId]);
    if (productId) await pool.query("DELETE FROM products WHERE id=$1", [productId]);
    if (categoryId) await pool.query("DELETE FROM categories WHERE id=$1", [categoryId]);
    if (userId) await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  }
});
