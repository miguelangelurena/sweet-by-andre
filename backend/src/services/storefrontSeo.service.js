const BRAND = "Sweet by Andre";
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const homeDescription =
  "Handcrafted Venezuelan desserts in Katy, Texas. Explore quesillo, cheesecakes and sweet treats for pickup or delivery in Katy and Houston. Order 48 hours ahead.";
export const homeTitle = "Venezuelan Desserts in Katy, TX | Sweet by Andre";
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const jsonForHtml = (value) =>
  JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
const description = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

export function siteOrigin(env = process.env) {
  try {
    const previewOrigin =
      env.APP_ENV === "staging"
        ? env.RENDER_EXTERNAL_URL ||
          (env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
            : "")
        : "";
    const url = new URL(env.SITE_URL || env.FRONTEND_URL || previewOrigin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.origin !== url.href.replace(/\/$/, "")
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export function isSiteIndexable(env = process.env) {
  return (
    env.APP_ENV === "production" &&
    env.SITE_INDEXABLE === "true" &&
    Boolean(siteOrigin(env))
  );
}
export function productPath(product) {
  const slug =
    String(product.name || "dessert")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "dessert";
  return `/products/${product.id}/${slug}`;
}
export function publicRoute(path) {
  if (path === "/") return { kind: "home" };
  if (path === "/catalog") return { kind: "catalog" };
  if (path === "/seasonal") return { kind: "seasonal" };
  const match = path.match(/^\/products\/([^/]+)(?:\/[^/]+)?$/);
  if (match && UUID.test(match[1]))
    return { kind: "product", productId: match[1].toLowerCase() };
  if (
    [
      "/payment-success",
      "/payment-cancelled",
      "/cart",
      "/checkout",
      "/admin",
    ].includes(path) ||
    path.startsWith("/admin/")
  )
    return { kind: "private" };
  return { kind: "missing" };
}
export function imageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "res.cloudinary.com" &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function pageMetadata(route, products = [], origin) {
  const product =
    route.kind === "product"
      ? products.find((p) => p.id === route.productId)
      : null;
  if (route.kind === "product" && !product) route = { kind: "missing" };
  const title = product
    ? `${product.name} in Katy, TX | ${BRAND}`
    : {
        home: homeTitle,
        catalog: `Dessert Menu in Katy & Houston | ${BRAND}`,
        seasonal: `Seasonal Desserts in Katy, TX | ${BRAND}`,
        private: `Your Order | ${BRAND}`,
        missing: `Page Not Found | ${BRAND}`,
      }[route.kind];
  const text = product
    ? description(
        `${product.description || product.name} Made in Katy, Texas. Order at least 48 hours ahead; pickup and delivery availability checked at checkout.`,
      )
    : {
        home: homeDescription,
        catalog:
          "Explore Venezuelan desserts, quesillo, cheesecakes and more from Sweet by Andre in Katy, Texas. Choose your dessert, size and pickup or delivery date.",
        seasonal:
          "Explore seasonal dessert collections from Sweet by Andre in Katy, Texas. Check the current menu and plan your celebration at least 48 hours ahead.",
        private: "Manage your order securely with Sweet by Andre.",
        missing:
          "This page is unavailable. Explore our dessert menu or return to Sweet by Andre's home page.",
      }[route.kind];
  const path = product
    ? productPath(product)
    : { home: "/", catalog: "/catalog", seasonal: "/seasonal" }[route.kind];
  const canonical = origin && path ? origin + path : null;
  const image =
    imageUrl(product?.image_url) ||
    (origin ? `${origin}/social-desserts.jpg` : null);
  const graph = [];
  if (origin && path) {
    const organization = {
      "@type": "Organization",
      "@id": origin + "/#organization",
      name: BRAND,
      url: origin + "/",
    };
    graph.push(organization, {
      "@type": "WebSite",
      "@id": origin + "/#website",
      name: BRAND,
      url: origin + "/",
      publisher: { "@id": organization["@id"] },
      inLanguage: "en-US",
    });
    graph.push({
      "@type": "WebPage",
      "@id": canonical + "#webpage",
      url: canonical,
      name: title,
      description: text,
      isPartOf: { "@id": origin + "/#website" },
      inLanguage: "en-US",
    });
    if (product) {
      const item = {
        "@type": "Product",
        "@id": canonical + "#product",
        name: product.name,
        description: product.description || text,
        url: canonical,
        brand: { "@type": "Brand", name: BRAND },
        category: product.category_name,
        ...(imageUrl(product.image_url)
          ? { image: [imageUrl(product.image_url)] }
          : {}),
      };
      const low = Number(product.min_price),
        high = Number(product.max_price),
        count = Number(product.offer_count);
      if (
        product.has_available_variants &&
        Number.isFinite(low) &&
        low > 0 &&
        Number.isFinite(high) &&
        high >= low &&
        Number.isInteger(count) &&
        count > 0
      )
        item.offers = {
          "@type": "AggregateOffer",
          url: canonical,
          priceCurrency: "USD",
          lowPrice: low.toFixed(2),
          highPrice: high.toFixed(2),
          offerCount: count,
          ...(product.inventory_mode === "stock"
            ? { availability: "https://schema.org/InStock" }
            : {}),
        };
      graph.push(item, {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: origin + "/",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Dessert menu",
            item: origin + "/catalog",
          },
          {
            "@type": "ListItem",
            position: 3,
            name: product.name,
            item: canonical,
          },
        ],
      });
    } else if (route.kind === "catalog")
      graph.push({
        "@type": "ItemList",
        itemListElement: products.map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: p.name,
          url: origin + productPath(p),
        })),
      });
  }
  return {
    kind: route.kind,
    product,
    title,
    description: text,
    canonical,
    image,
    graph,
  };
}
export function renderSeoHead(meta, indexable) {
  const tag = (name, value, property = false) =>
    `<meta ${property ? "property" : "name"}="${name}" content="${escapeHtml(value)}" />`;
  return `<title>${escapeHtml(meta.title)}</title>\n${tag("description", meta.description)}\n${tag("robots", indexable && !["private", "missing"].includes(meta.kind) ? "index, follow, max-image-preview:large" : "noindex, nofollow")}\n${meta.canonical ? `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />` : ""}\n${tag("og:type", meta.product ? "product" : "website", true)}${tag("og:site_name", BRAND, true)}${tag("og:locale", "en_US", true)}${tag("og:title", meta.title, true)}${tag("og:description", meta.description, true)}${meta.canonical ? tag("og:url", meta.canonical, true) : ""}${meta.image ? tag("og:image", meta.image, true) + tag("og:image:alt", meta.product?.name || "Handcrafted desserts by Sweet by Andre", true) : ""}${tag("twitter:card", "summary_large_image")}${tag("twitter:title", meta.title)}${tag("twitter:description", meta.description)}${meta.image ? tag("twitter:image", meta.image) : ""}\n${meta.graph.length ? `<script type="application/ld+json">${jsonForHtml({ "@context": "https://schema.org", "@graph": meta.graph })}</script>` : ""}`;
}
export function renderPublicContent(meta, products = []) {
  const link = (url, label) =>
    `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
  const price = (p) =>
    p.has_available_variants && Number(p.min_price) > 0
      ? `From $${Number(p.min_price).toFixed(2)}`
      : "Currently unavailable";
  const card = (p) =>
    `<li>${link(productPath(p), p.name)}<p>${escapeHtml(p.description)}</p><p>${price(p)}</p></li>`;
  let body;
  if (meta.product)
    body = `<nav aria-label="Breadcrumb">${link("/", "Home")} / ${link("/catalog", "Dessert menu")}</nav><h1>${escapeHtml(meta.product.name)}</h1>${imageUrl(meta.product.image_url) ? `<img src="${escapeHtml(imageUrl(meta.product.image_url))}" alt="${escapeHtml(meta.product.name)}" width="640" height="640" />` : ""}<p>${escapeHtml(meta.product.description)}</p><p>${price(meta.product)}</p><p>Choose sizes and options below once the shop loads. Order at least 48 hours ahead. Pickup and delivery availability is checked at checkout.</p>`;
  else if (meta.kind === "catalog")
    body = `<h1>Dessert Menu in Katy, Texas</h1><p>${escapeHtml(meta.description)}</p><ul>${products.map(card).join("")}</ul>`;
  else if (meta.kind === "home")
    body = `<h1>Handcrafted Venezuelan Desserts in Katy, Texas</h1><p>${escapeHtml(homeDescription)}</p><p>${link("/catalog", "Explore our dessert menu")} · ${link("/seasonal", "Seasonal sweets")}</p><h2>Rooted in tradition. Baked with love.</h2><p>Discover Venezuelan quesillo, cheesecakes and sweet creations for your table. Contact us to arrange pickup or check delivery availability for your area.</p>`;
  else if (meta.kind === "seasonal")
    body = `<h1>Seasonal sweets</h1><p>${escapeHtml(meta.description)}</p><p>${link("/catalog", "Explore the current dessert menu")}</p>`;
  else if (meta.kind === "missing")
    body = `<h1>Page not found</h1><p>This page is unavailable.</p>${link("/catalog", "Explore our dessert menu")}`;
  else
    body = `<h1>Your order</h1><p>Enable JavaScript to manage your order securely.</p>`;
  return `<main class="mx-auto max-w-5xl px-6 py-12">${body}<noscript><p>Enable JavaScript to choose dessert options and place an order. You can still browse the menu using the links above.</p></noscript></main>`;
}
