import express from "express";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadPublicProducts } from "../services/publicCatalog.service.js";
import {
  isSiteIndexable,
  siteOrigin,
  publicRoute,
  productPath,
  pageMetadata,
  renderSeoHead,
  renderPublicContent,
  escapeHtml,
} from "../services/storefrontSeo.service.js";
import { securityError } from "../utils/securityLog.js";
import { requestRateLimit } from "../middleware/requestRateLimit.js";

// Same HTML for people, crawlers and link previews; never vary on User-Agent.
export function createStorefrontRouter({
  indexPath,
  loadProducts = loadPublicProducts,
  env = process.env,
} = {}) {
  const router = express.Router();
  const template = readFileSync(indexPath, "utf8");
  const limitRenderedPages = requestRateLimit({
    action: "storefront",
    limit: 1000,
  });
  router.use((req, res, next) => {
    if (
      ["/catalog", "/sitemap.xml"].includes(req.path) ||
      publicRoute(req.path).kind === "product"
    ) {
      res.set("Cache-Control", "no-store");
      return limitRenderedPages(req, res, next);
    }
    next();
  });
  let heroAsset;
  try {
    const manifest = JSON.parse(
      readFileSync(join(dirname(indexPath), ".vite", "manifest.json"), "utf8"),
    );
    heroAsset = Object.values(manifest)
      .flatMap((entry) => entry.assets || [])
      .find((asset) =>
        /^assets\/hero-dessert-cutout-[\w-]+\.webp$/.test(asset),
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  router.get("/robots.txt", (_req, res) => {
    const origin = siteOrigin(env);
    const content = isSiteIndexable(env)
      ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /payment-success\nDisallow: /payment-cancelled\nSitemap: ${origin}/sitemap.xml\n`
      : "User-agent: *\nDisallow: /\n";
    res.set("Cache-Control", "no-store").type("text/plain").send(content);
  });
  router.get("/sitemap.xml", async (_req, res, next) => {
    res.set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex");
    if (!isSiteIndexable(env))
      return res
        .status(404)
        .type("text/plain")
        .send("Sitemap is unavailable while indexing is disabled.");
    try {
      const products = await loadProducts();
      const origin = siteOrigin(env);
      const urls = ["/", "/catalog", "/seasonal", ...products.map(productPath)];
      res
        .type("application/xml")
        .send(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((path) => `<url><loc>${escapeHtml(origin + path)}</loc></url>`).join("")}</urlset>`,
        );
    } catch (error) {
      next(error);
    }
  });
  router.get(/.*/, async (req, res, next) => {
    if (req.path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(req.path))
      return next();
    res.set("Cache-Control", "no-store");
    const normalized =
      req.path.length > 1 ? req.path.replace(/\/+$/, "") : req.path;
    if (normalized !== req.path)
      return res.redirect(301, normalized + req.url.slice(req.path.length));
    const route = publicRoute(req.path);
    try {
      const products = ["catalog", "product"].includes(route.kind)
        ? await loadProducts({ productId: route.productId || null })
        : [];
      const origin = siteOrigin(env);
      const meta = pageMetadata(route, products, origin);
      if (meta.product && req.path !== productPath(meta.product))
        return res.redirect(
          301,
          productPath(meta.product) + req.url.slice(req.path.length),
        );
      const indexable =
        isSiteIndexable(env) && !["private", "missing"].includes(meta.kind);
      if (!indexable) res.set("X-Robots-Tag", "noindex, nofollow");
      const nonce = randomBytes(18).toString("base64");
      const existingPolicy = res.get("Content-Security-Policy");
      if (existingPolicy)
        res.set(
          "Content-Security-Policy",
          existingPolicy.replace(
            /script-src 'self'(?=;)/,
            `script-src 'self' 'nonce-${nonce}'`,
          ),
        );
      const head =
        (meta.kind === "home" && heroAsset
          ? `<link rel="preload" as="image" href="/${escapeHtml(heroAsset)}" fetchpriority="high" />`
          : "") +
        renderSeoHead(meta, indexable).replace(
          '<script type="application/ld+json">',
          `<script type="application/ld+json" nonce="${nonce}">`,
        );
      const html = template
        .replace(/<title>[\s\S]*?<\/title>/i, "")
        .replace(/<meta\s+name="(?:description|robots)"[^>]*>/gi, "")
        .replace("</head>", head + "\n</head>")
        .replace(
          '<div id="root"></div>',
          `<div id="root">${renderPublicContent(meta, products)}</div>`,
        );
      res
        .status(meta.kind === "missing" ? 404 : 200)
        .type("html")
        .send(html);
    } catch (error) {
      securityError(error, "Storefront HTML unavailable", req.requestId);
      res
        .status(503)
        .set("Retry-After", "60")
        .set("X-Robots-Tag", "noindex")
        .type("html")
        .send(
          '<!doctype html><html lang="en"><head><title>Shop temporarily unavailable | Sweet by Andre</title><meta name="robots" content="noindex"></head><body><h1>The shop is temporarily unavailable</h1><p>Please try again shortly.</p></body></html>',
        );
    }
  });
  return router;
}
