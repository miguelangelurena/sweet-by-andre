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

export function legacyPublicPath(hash) {
  if (hash === "#catalog") return "/catalog";
  if (hash === "#seasonal") return "/seasonal";
  const match = hash.match(
    /^#product\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i,
  );
  return match ? `/products/${match[1].toLowerCase()}` : null;
}

export function productIdFromPath(pathname) {
  return (
    pathname.match(
      /^\/products\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/[^/]+)?\/?$/i,
    )?.[1] || null
  );
}
