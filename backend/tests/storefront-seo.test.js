import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { createStorefrontRouter } from "../src/routes/storefront.routes.js";
import {
  securityHeaders,
  handleHttpError,
} from "../src/middleware/httpSecurity.js";
import { pool } from "../src/config/database.js";
import { requireTestDatabase } from "./helpers/requireTestDatabase.js";
import { loadPublicProducts } from "../src/services/publicCatalog.service.js";
import {
  isSiteIndexable,
  siteOrigin,
  productPath,
  pageMetadata,
  renderSeoHead,
  renderPublicContent,
} from "../src/services/storefrontSeo.service.js";

after(() => pool.end());
const origin = "https://bakery.example";
const production = {
  APP_ENV: "production",
  SITE_INDEXABLE: "true",
  FRONTEND_URL: origin,
};
const product = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Chocoflan",
  description: "Chocolate cake and creamy flan.",
  category_name: "Desserts",
  min_price: "6.99",
  max_price: "42.99",
  offer_count: 3,
  has_available_variants: true,
  inventory_mode: "made_to_order",
  image_url: "https://res.cloudinary.com/example/image/upload/flan.jpg",
};
function fixture(
  env = production,
  loadProducts = async ({ productId } = {}) =>
    !productId || productId === product.id ? [product] : [],
) {
  const app = express();
  app.use(securityHeaders());
  app.use(
    createStorefrontRouter({
      env,
      loadProducts,
      indexPath: fileURLToPath(
        new URL("../../frontend/index.html", import.meta.url),
      ),
    }),
  );
  app.use((_req, res) => res.status(404).send("Not found"));
  app.use(handleHttpError);
  return app;
}
function schema(html) {
  return JSON.parse(
    html.match(
      /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/,
    )[1],
  );
}

test("indexing is opt-in for production with a valid explicit HTTPS origin", () => {
  assert.equal(isSiteIndexable(production), true);
  for (const env of [
    { ...production, APP_ENV: "staging" },
    { ...production, APP_ENV: "test" },
    { ...production, SITE_INDEXABLE: "false" },
    { ...production, FRONTEND_URL: "http://localhost:5173" },
    { ...production, FRONTEND_URL: "https://user:secret@bakery.example" },
    { ...production, FRONTEND_URL: "https://bakery.example/path" },
    { ...production, FRONTEND_URL: "https://one.example,https://two.example" },
  ])
    assert.equal(isSiteIndexable(env), false);
  assert.equal(
    siteOrigin({ ...production, SITE_URL: "https://canonical.example/" }),
    "https://canonical.example",
  );
});
test("public HTML includes route metadata, crawlable content and structured product prices", async () => {
  const app = fixture();
  const home = await request(app).get("/").expect(200);
  assert.match(home.text, /<title>Venezuelan Desserts in Katy, TX/);
  assert.match(
    home.text,
    /<meta name="robots" content="index, follow, max-image-preview:large"/,
  );
  assert.match(
    home.text,
    /<link rel="canonical" href="https:\/\/bakery.example\/"/,
  );
  assert.match(home.text, /<h1>Handcrafted Venezuelan Desserts/);
  assert.match(home.text, /href="\/catalog"/);
  assert.equal((home.text.match(/<title>/g) || []).length, 1);
  assert.equal(home.text.includes('content="noindex'), false);
  const catalog = await request(app).get("/catalog").expect(200);
  assert.ok(catalog.text.includes(`href="${productPath(product)}"`));
  const result = await request(app)
    .get(productPath(product) + "?utm_source=test")
    .expect(200);
  const graph = schema(result.text)["@graph"];
  const structured = graph.find((row) => row["@type"] === "Product");
  assert.equal(structured.offers.lowPrice, "6.99");
  assert.equal(structured.offers.highPrice, "42.99");
  assert.equal(structured.offers.offerCount, 3);
  assert.equal(structured.offers.priceCurrency, "USD");
  assert.equal(structured.offers.availability, undefined);
  assert.equal(structured.aggregateRating, undefined);
  assert.equal(structured.url, origin + productPath(product));
  assert.ok(graph.some((row) => row["@type"] === "BreadcrumbList"));
  const nonce = result.text.match(
    /type="application\/ld\+json" nonce="([^"]+)"/,
  )[1];
  assert.ok(
    result.headers["content-security-policy"].includes(`'nonce-${nonce}'`),
  );
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["x-robots-tag"], undefined);
  const crawler = await request(app)
    .get(productPath(product))
    .set("User-Agent", "Googlebot")
    .expect(200);
  assert.deepEqual(
    schema(crawler.text),
    graph.length ? schema(result.text) : {},
  );
});
test("old slugs redirect, unavailable products return real 404s and query parameters are not canonical", async () => {
  const app = fixture();
  for (const path of [
    `/products/${product.id}`,
    `/products/${product.id}/old-name`,
  ]) {
    const res = await request(app)
      .get(path + "?utm_source=test")
      .expect(301);
    assert.equal(
      res.headers.location,
      productPath(product) + "?utm_source=test",
    );
  }
  await request(app).get("/products/not-a-uuid/x").expect(404);
  const missing = await request(app)
    .get(`/products/${randomUUID()}/missing`)
    .expect(404);
  assert.match(missing.headers["x-robots-tag"], /noindex/);
  assert.equal(missing.text.includes('rel="canonical"'), false);
  await request(app).get("/not-a-page").expect(404);
  assert.equal(
    (await request(app).get("/catalog/").expect(301)).headers.location,
    "/catalog",
  );
  await request(app).get("/assets/missing.js").expect(404);
});
test("robots and sitemap exclude staging and private views; failures do not create soft 404s", async () => {
  const app = fixture();
  const robots = await request(app).get("/robots.txt").expect(200);
  assert.match(robots.text, /Sitemap: https:\/\/bakery.example\/sitemap.xml/);
  const map = await request(app).get("/sitemap.xml").expect(200);
  assert.match(map.headers["content-type"], /application\/xml/);
  assert.ok(map.text.includes(origin + productPath(product)));
  assert.equal(map.text.includes("/payment"), false);
  assert.equal(map.text.includes("/admin"), false);
  assert.equal(map.text.includes("#"), false);
  for (const path of [
    "/payment-success?session_id=cs_secret",
    "/payment-cancelled",
    "/cart",
    "/checkout",
    "/admin/login",
  ]) {
    const response = await request(app).get(path).expect(200);
    assert.match(response.headers["x-robots-tag"], /noindex/);
    assert.equal(response.text.includes("cs_secret"), false);
    assert.equal(response.text.includes('rel="canonical"'), false);
  }
  for (const env of [
    { ...production, APP_ENV: "staging" },
    { ...production, SITE_INDEXABLE: "false" },
  ]) {
    const preview = fixture(env);
    assert.match(
      (await request(preview).get("/robots.txt").expect(200)).text,
      /Disallow: \/\n/,
    );
    await request(preview).get("/sitemap.xml").expect(404);
    assert.match(
      (await request(preview).get("/").expect(200)).headers["x-robots-tag"],
      /noindex/,
    );
  }
  const unavailable = fixture(production, async () => {
    throw new Error("private SQL details");
  });
  const failed = await request(unavailable).get("/catalog").expect(503);
  assert.equal(failed.headers["retry-after"], "60");
  assert.equal(failed.text.includes("private SQL"), false);
});
test("database content is escaped in HTML and JSON-LD and unsafe image origins are omitted", () => {
  const malicious = {
    ...product,
    name: "Cake </title><script>alert(1)</script>",
    description: "</script><img src=x onerror=alert(1)>",
    image_url: "javascript:alert(1)",
  };
  const meta = pageMetadata(
    { kind: "product", productId: product.id },
    [malicious],
    origin,
  );
  const head = renderSeoHead(meta, true),
    content = renderPublicContent(meta, [malicious]);
  assert.equal(head.includes("</title><script>"), false);
  assert.equal(content.includes("<img src=x"), false);
  assert.equal(head.includes('src="javascript:'), false);
  assert.equal(
    schema(head)["@graph"].find((row) => row["@type"] === "Product").name,
    malicious.name,
  );
  assert.equal(
    schema(head)["@graph"].find((row) => row["@type"] === "Product").image,
    undefined,
  );
  const unavailable = pageMetadata(
    { kind: "product", productId: product.id },
    [{ ...product, has_available_variants: false, min_price: null }],
    origin,
  );
  assert.equal(
    unavailable.graph.find((row) => row["@type"] === "Product").offers,
    undefined,
  );
});
test("HTML repository and API visibility agree for hidden products and inactive categories", async () => {
  await requireTestDatabase(pool);
  let category, id, variant;
  try {
    category = (
      await pool.query(
        "INSERT INTO categories(name) VALUES ($1) RETURNING id",
        [`SEO ${randomUUID()}`],
      )
    ).rows[0].id;
    id = (
      await pool.query(
        "INSERT INTO products(name,price,stock,category_id,is_available,inventory_mode) VALUES ('SEO fixture',5,3,$1,true,'made_to_order') RETURNING id",
        [category],
      )
    ).rows[0].id;
    variant = (
      await pool.query(
        "INSERT INTO product_variants(product_id,price,stock) VALUES ($1,6.99,0) RETURNING id",
        [id],
      )
    ).rows[0].id;
    const rows = await loadPublicProducts({ productId: id });
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].min_price), 6.99);
    assert.equal(Number(rows[0].max_price), 6.99);
    assert.equal(rows[0].offer_count, 1);
    await pool.query("UPDATE products SET is_available=false WHERE id=$1", [
      id,
    ]);
    assert.equal((await loadPublicProducts({ productId: id })).length, 0);
    await pool.query("UPDATE products SET is_available=true WHERE id=$1", [id]);
    await pool.query("UPDATE categories SET is_active=false WHERE id=$1", [
      category,
    ]);
    assert.equal((await loadPublicProducts({ productId: id })).length, 0);
  } finally {
    if (variant)
      await pool.query("DELETE FROM product_variants WHERE id=$1", [variant]);
    if (id) await pool.query("DELETE FROM products WHERE id=$1", [id]);
    if (category)
      await pool.query("DELETE FROM categories WHERE id=$1", [category]);
  }
});
