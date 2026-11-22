import assert from "node:assert/strict";
import { productPath } from "../../src/services/storefrontSeo.service.js";

export const DEFAULT_STAGING_URL =
  "https://sweet-by-andre-staging.onrender.com";

export function stagingOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      "Use an HTTPS staging origin without credentials, path, query or fragment",
    );
  }
}

// Read-only operational smoke checks. No .env, database, browser sessions,
// credentials, provider calls, carts or orders are used or created.
export async function checkStagingReadiness({
  url = DEFAULT_STAGING_URL,
  fetchImpl = fetch,
  timeoutMs = 45000,
} = {}) {
  const origin = stagingOrigin(url);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
    throw new Error("Invalid request timeout");
  const checks = [];
  const totalTimeout = AbortSignal.timeout(120000);
  let lastHttpStatus;
  async function request(path, method = "GET") {
    const response = await fetchImpl(origin + path, {
      method,
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept:
          method === "HEAD" ? "*/*" : "text/html, application/json, text/plain",
      },
      signal: AbortSignal.any([totalTimeout, AbortSignal.timeout(timeoutMs)]),
    });
    lastHttpStatus = response.status;
    return {
      status: response.status,
      headers: response.headers,
      text: method === "HEAD" ? "" : await response.text(),
    };
  }
  async function check(id, label, verify) {
    lastHttpStatus = undefined;
    try {
      await verify();
      checks.push({ id, label, passed: true });
    } catch (error) {
      checks.push({
        id,
        label,
        passed: false,
        ...(Number.isInteger(lastHttpStatus)
          ? { httpStatus: lastHttpStatus }
          : {}),
        reason: ["TimeoutError", "AbortError"].includes(error.name)
          ? "The request timed out"
          : "Unexpected response or unavailable service; inspect the application and deployment logs",
      });
    }
  }
  const graph = (html) =>
    JSON.parse(
      html.match(
        /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/,
      )[1],
    )["@graph"];
  let products, primary;
  await check("health", "Backend saludable sin datos internos", async () => {
    const r = await request("/api/health");
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text), { status: "OK" });
  });
  await check(
    "public-html",
    "HTML inicial y cabeceras de seguridad",
    async () => {
      const r = await request("/");
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      assert.equal(r.headers.get("x-frame-options"), "DENY");
      assert.equal(r.headers.get("referrer-policy"), "no-referrer");
      assert.match(
        r.headers.get("strict-transport-security"),
        /max-age=31536000/,
      );
      assert.match(
        r.headers.get("content-security-policy"),
        /script-src 'self'/,
      );
      assert.match(
        r.headers.get("content-security-policy"),
        /frame-ancestors 'none'/,
      );
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
      assert.match(r.text, /<h1>Handcrafted Venezuelan Desserts/);
      assert.match(r.text, /<meta name="robots" content="noindex, nofollow"/);
      assert.equal((r.text.match(/<title>/g) || []).length, 1);
      assert.ok(graph(r.text).some((row) => row["@type"] === "Organization"));
    },
  );
  await check("indexing", "Staging fuera de los buscadores", async () => {
    const r = await request("/robots.txt");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/plain/);
    assert.match(r.text, /Disallow: \/\n/);
    assert.equal((await request("/sitemap.xml")).status, 404);
  });
  await check(
    "catalog",
    "Catálogo público con enlaces rastreables",
    async () => {
      const api = await request("/api/products");
      assert.equal(api.status, 200);
      assert.equal(api.headers.get("cache-control"), "no-store");
      products = JSON.parse(api.text).products;
      assert.ok(Array.isArray(products) && products.length > 0);
      primary = products.find(
        (p) => p.has_available_variants && Number(p.min_price) > 0,
      );
      assert.ok(primary);
      const page = await request("/catalog");
      assert.equal(page.status, 200);
      assert.match(page.text, /<h1>Dessert Menu in Katy/);
      for (const product of products)
        assert.ok(page.text.includes(`href="${productPath(product)}"`));
    },
  );
  await check(
    "product",
    "Precio, canonical y datos estructurados",
    async () => {
      assert.ok(primary);
      const path = productPath(primary),
        r = await request(path);
      assert.equal(r.status, 200);
      assert.ok(r.text.includes(`href="${origin + path}"`));
      const schema = graph(r.text).find((row) => row["@type"] === "Product");
      assert.equal(schema.name, primary.name);
      assert.equal(Number(schema.offers.lowPrice), Number(primary.min_price));
      assert.equal(schema.offers.priceCurrency, "USD");
      assert.equal(schema.aggregateRating, undefined);
      const old = await request(`/products/${primary.id}`);
      assert.equal(old.status, 301);
      assert.equal(old.headers.get("location"), path);
    },
  );
  await check("missing-page", "Rutas inexistentes devuelven 404", async () => {
    const r = await request("/staging-readiness-page-that-does-not-exist");
    assert.equal(r.status, 404);
    assert.match(r.headers.get("x-robots-tag"), /noindex/);
  });
  await check(
    "anonymous-admin",
    "Acceso administrativo anónimo rechazado",
    async () => {
      for (const path of [
        "/api/auth/me",
        "/api/admin/products",
        "/api/admin/orders",
      ]) {
        const r = await request(path);
        assert.equal(r.status, 401);
        assert.equal(r.headers.get("cache-control"), "no-store");
      }
    },
  );
  await check(
    "payment-return",
    "Retornos de pago sin datos personales ni indexación",
    async () => {
      for (const path of ["/payment-success", "/payment-cancelled"]) {
        const r = await request(path);
        assert.equal(r.status, 200);
        assert.match(r.headers.get("x-robots-tag"), /noindex/);
        assert.equal(r.text.includes('rel="canonical"'), false);
        assert.equal(r.text.includes("application/ld+json"), false);
      }
    },
  );
  await check("social-image", "Imagen para compartir disponible", async () => {
    const r = await request("/social-desserts.jpg", "HEAD");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /image\/jpeg/);
  });
  return {
    checkedAt: new Date().toISOString(),
    origin,
    mode: "read-only",
    tests: checks.length,
    passed: checks.filter((c) => c.passed).length,
    failed: checks.filter((c) => !c.passed).length,
    checks,
    ...(products ? { catalogProducts: products.length } : {}),
    scope: [
      "Public HTTP responses only; no authenticated browser session",
      "Does not verify uploads, actual payments, refunds or email/SMS delivery",
      "Use the acceptance checklist for private workflows",
    ],
  };
}
