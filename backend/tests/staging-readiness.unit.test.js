import test from "node:test";
import assert from "node:assert/strict";
import {
  checkStagingReadiness,
  stagingOrigin,
} from "../scripts/lib/stagingReadiness.js";

const origin = "https://preview.example";
const id = "a0000000-0000-4000-8000-000000000001";
const path = `/products/${id}/chocoflan`;
const product = {
  id,
  name: "Chocoflan",
  min_price: "6.99",
  has_available_variants: true,
};
const home =
  '<title>Sweet by Andre</title><meta name="robots" content="noindex, nofollow"><h1>Handcrafted Venezuelan Desserts</h1><script type="application/ld+json">{"@graph":[{"@type":"Organization"}]}</script>';
const headers = {
  "content-type": "text/html",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000",
  "content-security-policy": "script-src 'self';frame-ancestors 'none'",
  "cache-control": "no-store",
};
function fixture(overrides = {}) {
  const entries = {
    "/api/health": { body: JSON.stringify({ status: "OK" }) },
    "/": { body: home },
    "/robots.txt": {
      body: "User-agent: *\nDisallow: /\n",
      headers: { "content-type": "text/plain" },
    },
    "/sitemap.xml": { status: 404 },
    "/api/products": { body: JSON.stringify({ products: [product] }) },
    "/catalog": {
      body: `<h1>Dessert Menu in Katy</h1><a href="${path}">Chocoflan</a>`,
    },
    [path]: {
      body: `<link rel="canonical" href="${origin + path}"><script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "Product", name: "Chocoflan", offers: { lowPrice: "6.99", priceCurrency: "USD" } }] })}</script>`,
    },
    [`/products/${id}`]: { status: 301, headers: { location: path } },
    "/staging-readiness-page-that-does-not-exist": { status: 404 },
    "/api/auth/me": { status: 401 },
    "/api/admin/products": { status: 401 },
    "/api/admin/orders": { status: 401 },
    "/payment-success": {},
    "/payment-cancelled": {},
    "/social-desserts.jpg": { headers: { "content-type": "image/jpeg" } },
    ...overrides,
  };
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, origin);
      assert.ok(["GET", "HEAD"].includes(options.method));
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers.Cookie, undefined);
      calls.push({ path: parsed.pathname, method: options.method });
      const entry = entries[parsed.pathname];
      assert.ok(entry);
      return new Response(options.method === "HEAD" ? null : entry.body || "", {
        status: entry.status || 200,
        headers: { ...headers, ...entry.headers },
      });
    },
  };
}
test("staging smoke checks use only public GET/HEAD requests and require all expected protections", async () => {
  const f = fixture(),
    report = await checkStagingReadiness({
      url: origin,
      fetchImpl: f.fetchImpl,
    });
  assert.equal(report.tests, 9);
  assert.equal(report.passed, 9);
  assert.equal(report.failed, 0);
  assert.equal(report.catalogProducts, 1);
  assert.equal(report.mode, "read-only");
  assert.ok(f.calls.some((c) => c.method === "HEAD"));
});
test("a missing security policy fails the check even if the homepage responds 200", async () => {
  const f = fixture({
      "/": { body: home, headers: { "content-security-policy": "" } },
    }),
    report = await checkStagingReadiness({
      url: origin,
      fetchImpl: f.fetchImpl,
    });
  assert.equal(report.checks.find((c) => c.id === "public-html").passed, false);
  assert.equal(report.failed, 1);
});
test("unexpected anonymous access is reported without serializing customer data", async () => {
  const f = fixture({
    "/api/admin/products": {
      status: 200,
      body: '{"email":"private-customer@example.com","token":"private-secret"}',
    },
  });
  const report = await checkStagingReadiness({
    url: origin,
    fetchImpl: f.fetchImpl,
  });
  assert.equal(
    report.checks.find((c) => c.id === "anonymous-admin").passed,
    false,
  );
  assert.equal(JSON.stringify(report).includes("private-customer"), false);
  assert.equal(JSON.stringify(report).includes("private-secret"), false);
});
test("redirects are not followed or mistaken for healthy API responses", async () => {
  const f = fixture({
      "/api/health": {
        status: 302,
        headers: { location: "https://other.example" },
      },
    }),
    report = await checkStagingReadiness({
      url: origin,
      fetchImpl: f.fetchImpl,
    });
  assert.equal(report.checks.find((c) => c.id === "health").passed, false);
});
test("provider errors and unavailable catalogs never become a passing report", async () => {
  const f = fixture({
      "/api/products": {
        status: 503,
        body: '{"detail":"private SQL details"}',
      },
    }),
    report = await checkStagingReadiness({
      url: origin,
      fetchImpl: f.fetchImpl,
    });
  assert.equal(report.checks.find((c) => c.id === "catalog").passed, false);
  assert.equal(report.checks.find((c) => c.id === "product").passed, false);
  assert.equal(JSON.stringify(report).includes("private SQL"), false);
});
test("timeouts produce bounded diagnostic information without exposing request errors", async () => {
  const report = await checkStagingReadiness({
    url: origin,
    fetchImpl: async () => {
      throw new DOMException("private network details", "TimeoutError");
    },
  });
  assert.equal(report.failed, 9);
  assert.equal(
    report.checks.find((c) => c.id === "health").reason,
    "The request timed out",
  );
  assert.ok(report.checks.every((c) => typeof c.reason === "string"));
  assert.equal(JSON.stringify(report).includes("private network"), false);
});
test("staging origins reject credentials, insecure protocols, paths and query strings", () => {
  assert.equal(stagingOrigin(origin + "/"), origin);
  for (const value of [
    "http://preview.example",
    "https://user:secret@preview.example",
    "https://preview.example/path",
    "https://preview.example?token=x",
    "https://preview.example#checkout",
    "not-a-url",
  ])
    assert.throws(() => stagingOrigin(value));
});
