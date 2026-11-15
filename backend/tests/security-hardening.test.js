import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";
import request from "supertest";
import express from "express";
import bcrypt from "bcrypt";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import { requireTestDatabase } from "./helpers/requireTestDatabase.js";
import {
  credentialVersion,
  validAuthenticatedSession,
} from "../src/services/authCredentials.js";
import { requestRateLimit } from "../src/middleware/requestRateLimit.js";
import { securityError } from "../src/utils/securityLog.js";
import { deleteImageFromCloudinary } from "../src/services/cloudinary.service.js";
import { uploadImageToCloudinary } from "../src/services/cloudinary.service.js";
import { cloudinary } from "../src/config/cloudinary.js";
import {
  generateGuestToken,
  hashGuestToken,
  GUEST_CART_COOKIE,
} from "../src/utils/guestCart.js";
import { stripe } from "../src/config/stripe.js";
import { securityHeaders } from "../src/middleware/httpSecurity.js";

after(() => pool.end());

test("missing image hosting credentials fail before any provider request", async (t) => {
  t.mock.method(cloudinary, "config", () => ({}));
  const upload = t.mock.method(cloudinary.uploader, "upload_stream", () =>
    assert.fail("Unconfigured image hosting must not be contacted"),
  );
  await assert.rejects(
    uploadImageToCloudinary(Buffer.from("fixture"), randomUUID()),
    { code: "IMAGE_HOSTING_NOT_CONFIGURED" },
  );
  assert.equal(upload.mock.callCount(), 0);
});

test("hosted security headers enforce HTTPS while local development remains usable", async () => {
  const previous = process.env.NODE_ENV;
  try {
    for (const environment of ["production", "test"]) {
      process.env.NODE_ENV = environment;
      const fixture = express();
      fixture.use(securityHeaders());
      fixture.get("/", (_req, res) => res.send("fixture"));
      const response = await request(fixture).get("/").expect(200);
      if (environment === "production") {
        assert.equal(
          response.headers["strict-transport-security"],
          "max-age=31536000",
        );
        assert.match(
          response.headers["content-security-policy"],
          /upgrade-insecure-requests/,
        );
      } else {
        assert.equal(response.headers["strict-transport-security"], undefined);
        assert.equal(
          response.headers["content-security-policy"].includes(
            "upgrade-insecure-requests",
          ),
          false,
        );
      }
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("signed webhooks from the wrong Stripe mode are rejected before database processing", async () => {
  const previous = {
    app: process.env.APP_ENV,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  };
  const secret = "whsec_security_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  try {
    for (const [environment, livemode] of [
      ["staging", true],
      ["production", false],
    ]) {
      process.env.APP_ENV = environment;
      const payload = JSON.stringify({
        id: "evt_security_fixture",
        type: "checkout.session.completed",
        livemode,
        data: { object: {} },
      });
      const signature = stripe.webhooks.generateTestHeaderString({
        payload,
        secret,
      });
      await request(app)
        .post("/api/payments/webhook")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", signature)
        .send(payload)
        .expect(400);
    }
  } finally {
    for (const [name, value] of [
      ["APP_ENV", previous.app],
      ["STRIPE_WEBHOOK_SECRET", previous.secret],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("expired guest credentials cannot recover access or authorize another cart", async () => {
  await requireTestDatabase(pool);
  const token = generateGuestToken();
  const cart = (
    await pool.query(
      "INSERT INTO cart (guest_token_hash,created_at) VALUES ($1,NOW()-INTERVAL '31 days') RETURNING id",
      [hashGuestToken(token)],
    )
  ).rows[0].id;
  const agent = request.agent(app);
  let replacement;
  try {
    await request(app)
      .get("/api/guest/cart")
      .set("Cookie", `${GUEST_CART_COOKIE}=${token}`)
      .expect(404);
    replacement = (
      await agent
        .post("/api/guest/cart")
        .set("Cookie", `${GUEST_CART_COOKIE}=${token}`)
        .expect(201)
    ).body.cart.id;
    assert.notEqual(replacement, cart);
    const csrf = (await agent.get("/api/guest/cart/csrf-token").expect(200))
      .body.csrf_token;
    await agent
      .post("/api/guest/cart/items")
      .set("X-CSRF-Token", csrf)
      .send({ quantity: 1001, variant_id: randomUUID() })
      .expect(400);
    assert.equal(
      (
        await pool.query("SELECT COUNT(*)::int AS n FROM cart WHERE id=$1", [
          cart,
        ])
      ).rows[0].n,
      1,
    );
  } finally {
    await pool.query("DELETE FROM cart WHERE id=ANY($1::uuid[])", [
      [cart, replacement].filter(Boolean),
    ]);
  }
});

test("HTTP security headers, private caching and safe parser failures", async () => {
  const response = await request(app).get("/api/products").expect(200);
  assert.equal(response.headers["x-powered-by"], undefined);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(
    response.headers["content-security-policy"],
    /script-src 'self';/,
  );
  assert.match(
    response.headers["content-security-policy"],
    /frame-ancestors 'none'/,
  );
  assert.match(response.headers["x-request-id"], /^[a-f0-9-]{36}$/);
  for (const body of [
    '{"a":',
    "[]",
    '{"__proto__":{"admin":true}}',
    '{"data":{"constructor":{"prototype":{"admin":true}}}}',
  ]) {
    const invalid = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send(body)
      .expect(400);
    assert.match(invalid.headers["content-type"], /application\/json/);
    assert.equal(invalid.text.includes("SyntaxError"), false);
    assert.equal(invalid.text.includes("node_modules"), false);
  }
  await request(app)
    .post("/api/auth/login")
    .send({ email: "x".repeat(110000) })
    .expect(413);
  await request(app)
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .set("Content-Encoding", "gzip")
    .send(gzipSync('{"email":"test@example.com"}'))
    .expect(415);
  await request(app)
    .post("/api/auth/login")
    .set("Sec-Fetch-Site", "cross-site")
    .send({})
    .expect(403);
  await request(app).get("/.env").expect(404);
  await request(app).get("/.git/config").expect(404);
  await request(app)
    .get("/api/no-such-route")
    .expect("Content-Type", /json/)
    .expect(404);
  for (const id of ["not-a-uuid", "1%27%20OR%201=1--"])
    await request(app).get(`/api/products/${id}`).expect(400);
  assert.equal({}.admin, undefined);
});

test("sessions require current credentials, recent activity and an absolute expiry", () => {
  const now = Date.now(),
    hash = "fixture-hash";
  const current = {
    credentialVersion: credentialVersion(hash),
    authenticatedAt: now - 1000,
    lastSeenAt: now - 500,
  };
  assert.equal(validAuthenticatedSession(current, hash, now), true);
  for (const session of [
    { ...current, lastSeenAt: now - 30 * 60 * 1000 },
    { ...current, authenticatedAt: now - 8 * 60 * 60 * 1000 },
    { ...current, lastSeenAt: now + 1000 },
    { ...current, authenticatedAt: undefined },
    { ...current, credentialVersion: "stale" },
  ])
    assert.equal(validAuthenticatedSession(session, hash, now), false);
});

test("safe error logs exclude provider messages, SQL details and customer data", (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  securityError(
    {
      code: "23505",
      message: "password-secret",
      detail: "customer@example.com",
    },
    "Database operation failed",
    randomUUID(),
  );
  securityError({ code: "evil\npassword-secret" }, "Provider failed");
  const serialized = JSON.stringify(logs);
  assert.ok(serialized.includes("23505"));
  assert.ok(serialized.includes("INTERNAL_ERROR"));
  assert.equal(serialized.includes("password-secret"), false);
  assert.equal(serialized.includes("customer@example.com"), false);
});

test("persistent request quotas cannot be bypassed by rotating an IP for the same cart", async () => {
  await requireTestDatabase(pool);
  const action = `security-${randomUUID()}`,
    identity = randomUUID(),
    keys = [];
  const middleware = requestRateLimit({
    action,
    limit: 10,
    identityLimit: 2,
    enabled: () => true,
  });
  const hash = (value) =>
    createHmac("sha256", process.env.SESSION_SECRET)
      .update(value)
      .digest("hex");
  async function invoke(ip) {
    keys.push(
      `request:${action}:ip:${hash(ip)}`,
      `request:${action}:identity:${hash(identity)}`,
    );
    const res = {
      code: 200,
      headers: {},
      set(k, v) {
        this.headers[k] = v;
      },
      status(n) {
        this.code = n;
        return this;
      },
      json(body) {
        this.body = body;
      },
    };
    await middleware({ ip, cartId: identity }, res, () => {
      res.passed = true;
    });
    return res;
  }
  try {
    assert.equal((await invoke("ip-one")).passed, true);
    assert.equal((await invoke("ip-two")).passed, true);
    const blocked = await invoke("ip-three");
    assert.equal(blocked.code, 429);
    assert.ok(Number(blocked.headers["Retry-After"]) > 0);
    const failed = requestRateLimit({
      action,
      limit: 1,
      enabled: () => true,
      database: {
        query: async () => {
          throw new Error("provider-secret");
        },
      },
    });
    const res = {
      status(n) {
        this.code = n;
        return this;
      },
      json(body) {
        this.body = body;
      },
    };
    await failed({ ip: "other" }, res, () =>
      assert.fail("Quota failure must not authorize a request"),
    );
    assert.equal(res.code, 503);
    assert.equal(JSON.stringify(res.body).includes("provider-secret"), false);
  } finally {
    await pool.query("DELETE FROM auth_rate_limits WHERE key=ANY($1::text[])", [
      keys,
    ]);
  }
});

test(
  "catalog visibility, upload boundaries, logout CSRF and session revocation",
  { timeout: 30000 },
  async (t) => {
    await requireTestDatabase(pool);
    const password = "SecurityHardeningFixture123!",
      email = `hardening-${randomUUID()}@example.com`;
    const agent = request.agent(app),
      users = [];
    let category, product, variant, image;
    try {
      const user = (
        await pool.query(
          `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
      VALUES ('Security','Fixture',$1,'5551234567',$2,'admin') RETURNING id`,
          [email, await bcrypt.hash(password, 4)],
        )
      ).rows[0].id;
      users.push(user);
      await agent.post("/api/auth/login").send({ email, password }).expect(200);
      const token = (await agent.get("/api/cart/csrf-token").expect(200)).body
        .csrf_token;
      category = (
        await pool.query(
          "INSERT INTO categories (name) VALUES ($1) RETURNING id",
          [`Security ${randomUUID()}`],
        )
      ).rows[0].id;
      product = (
        await pool.query(
          "INSERT INTO products (name,price,stock,category_id,is_available,inventory_mode) VALUES ('Security fixture',5,2,$1,false,'made_to_order') RETURNING id",
          [category],
        )
      ).rows[0].id;
      variant = (
        await pool.query(
          "INSERT INTO product_variants (product_id,price,stock) VALUES ($1,5,2) RETURNING id",
          [product],
        )
      ).rows[0].id;
      image = (
        await pool.query(
          "INSERT INTO product_images (product_id,image_url,display_order) VALUES ($1,'https://res.cloudinary.com/example/image/upload/fixture.png',1) RETURNING id",
          [product],
        )
      ).rows[0].id;
      await t.test(
        "hidden products and inactive categories do not expose public variants or images",
        async () => {
          for (const suffix of ["", "/images", "/variants"])
            await request(app)
              .get(`/api/products/${product}${suffix}`)
              .expect(404);
          await agent.get(`/api/admin/products/${product}/images`).expect(200);
          await agent
            .get(`/api/admin/products/${product}/variants`)
            .expect(200);
          await request(app)
            .get(`/api/admin/products/${product}/images`)
            .expect(401);
          await pool.query(
            "UPDATE products SET is_available=true WHERE id=$1",
            [product],
          );
          await pool.query(
            "UPDATE categories SET is_active=false WHERE id=$1",
            [category],
          );
          for (const suffix of ["", "/images", "/variants"])
            await request(app)
              .get(`/api/products/${product}${suffix}`)
              .expect(404);
          await pool.query("UPDATE categories SET is_active=true WHERE id=$1", [
            category,
          ]);
        },
      );
      await t.test(
        "unsafe image URLs and malformed uploads are rejected without contacting Cloudinary",
        async () => {
          for (const image_url of [
            "javascript:alert(1)",
            "http://res.cloudinary.com/x",
            "https://res.cloudinary.com.evil.example/x",
            "https://user:secret@res.cloudinary.com/x",
          ])
            await agent
              .post(`/api/products/${product}/images`)
              .set("X-CSRF-Token", token)
              .send({ image_url, display_order: 2 })
              .expect(400);
          await agent
            .post(`/api/products/${product}/images/upload`)
            .set("X-CSRF-Token", token)
            .attach(
              "image",
              Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
              ),
              { filename: "fake.png", contentType: "image/png" },
            )
            .expect(400);
          await agent
            .post(`/api/products/${product}/images/upload`)
            .set("X-CSRF-Token", token)
            .field("unexpected", "x")
            .expect(400);
          await agent
            .post(`/api/products/${product}/images/upload`)
            .set("X-CSRF-Token", token)
            .attach("image", Buffer.alloc(5 * 1024 * 1024 + 1), {
              filename: "large.png",
              contentType: "image/png",
            })
            .expect(400);
          await assert.rejects(
            deleteImageFromCloudinary("another-business/products/image"),
            /restricted/,
          );
        },
      );
      await t.test(
        "unconfigured image hosting returns a safe actionable response",
        async (imageTest) => {
          imageTest.mock.method(cloudinary, "config", () => ({}));
          imageTest.mock.method(cloudinary.uploader, "upload_stream", () =>
            assert.fail("Image provider must not be contacted"),
          );
          const png = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
            "base64",
          );
          const unavailable = await agent
            .post(`/api/products/${product}/images/upload`)
            .set("X-CSRF-Token", token)
            .attach("image", png, {
              filename: "fixture.png",
              contentType: "image/png",
            })
            .expect(503);
          assert.equal(unavailable.body.code, "IMAGE_HOSTING_NOT_CONFIGURED");
          assert.match(
            unavailable.body.message,
            /Photo uploads are not configured/,
          );
          assert.equal(
            JSON.stringify(unavailable.body).includes("api_secret"),
            false,
          );
        },
      );
      await t.test(
        "logout requires the current session CSRF token",
        async () => {
          await agent.post("/api/auth/logout").expect(403);
          await agent.get("/api/admin/products").expect(200);
          await agent
            .post("/api/auth/logout")
            .set("X-CSRF-Token", "0".repeat(64))
            .expect(403);
          await agent
            .post("/api/auth/logout")
            .set("X-CSRF-Token", token)
            .expect(200);
          await agent.get("/api/auth/me").expect(401);
        },
      );
      await t.test("idle sessions lose API access", async () => {
        await agent
          .post("/api/auth/login")
          .send({ email, password })
          .expect(200);
        await pool.query(
          "UPDATE session SET sess=(sess::jsonb || jsonb_build_object('lastSeenAt',$2::bigint))::json WHERE sess->>'userId'=$1",
          [user, Date.now() - 31 * 60 * 1000],
        );
        const expired = await agent.get("/api/auth/me").expect(401);
        assert.match(expired.headers["set-cookie"].join(";"), /connect\.sid=;/);
        assert.equal(
          (
            await pool.query(
              "SELECT COUNT(*)::int AS n FROM session WHERE sess->>'userId'=$1",
              [user],
            )
          ).rows[0].n,
          0,
        );
      });
      await t.test(
        "public account registration is off by default in hosted environments",
        async () => {
          const old = process.env.APP_ENV;
          process.env.APP_ENV = "staging";
          try {
            await request(app).post("/api/auth/register").send({}).expect(403);
          } finally {
            if (old === undefined) delete process.env.APP_ENV;
            else process.env.APP_ENV = old;
          }
        },
      );
    } finally {
      await pool.query(
        "DELETE FROM session WHERE sess->>'userId'=ANY($1::text[])",
        [users],
      );
      if (image)
        await pool.query("DELETE FROM product_images WHERE id=$1", [image]);
      if (variant)
        await pool.query("DELETE FROM product_variants WHERE id=$1", [variant]);
      if (product)
        await pool.query("DELETE FROM products WHERE id=$1", [product]);
      if (category)
        await pool.query("DELETE FROM categories WHERE id=$1", [category]);
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    }
  },
);
