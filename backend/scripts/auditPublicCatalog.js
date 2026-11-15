import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Public GET/HEAD requests only. No .env, authentication, Docker or DB access.
const origin = new URL(
  process.argv[2] || "https://sweet-by-andre-staging.onrender.com",
).origin;
const createdAt = new Date().toISOString();
const output = fileURLToPath(
  new URL(
    `../../tmp/catalog-review/audit-${createdAt.replaceAll(/[:.]/g, "-")}/`,
    import.meta.url,
  ),
);
const json = async (path) => {
  const result = await fetch(`${origin}${path}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!result.ok)
    throw new Error(`Public catalog request failed: HTTP ${result.status}`);
  return result.json();
};
const cents = (value) => {
  const number = Number(value);
  return Number.isFinite(number) &&
    number > 0 &&
    Math.abs(number * 100 - Math.round(number * 100)) < 0.00001
    ? Math.round(number * 100)
    : null;
};
const csv = (value) => {
  const text = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
const cell = (value) =>
  String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll(/\r?\n/g, " ");
const photoCache = new Map();

async function photoStatus(raw) {
  if (photoCache.has(raw)) return photoCache.get(raw);
  const task = (async () => {
    try {
      const url = new URL(raw, origin);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        ![new URL(origin).hostname, "res.cloudinary.com"].includes(url.hostname)
      )
        return { url: raw, ok: false, reason: "host requires manual review" };
      const result = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(15000),
      });
      const type = result.headers.get("content-type") || "";
      return {
        url: raw,
        status: result.status,
        ok: result.ok && type.startsWith("image/"),
        type,
        bytes: Number(result.headers.get("content-length")) || null,
      };
    } catch {
      return { url: raw, ok: false, reason: "request failed or timed out" };
    }
  })();
  photoCache.set(raw, task);
  return task;
}

try {
  const listed = (await json("/api/products")).products;
  if (!Array.isArray(listed))
    throw new Error("Unexpected public catalog response");
  const products = [],
    findings = [],
    rows = [
      [
        "Producto",
        "Categoria",
        "Opciones",
        "Precio USD",
        "Puntos preparacion",
        "Variante ID",
        "Aprobacion Andrea",
      ],
    ];
  for (const product of listed) {
    const [detail, response] = await Promise.all([
      json(`/api/products/${encodeURIComponent(product.id)}`),
      json(`/api/products/${encodeURIComponent(product.id)}/variants`),
    ]);
    const variants = response.variants || [],
      images = detail.product?.images || [];
    const photos = await Promise.all(
      images.map((image) => photoStatus(image.image_url)),
    );
    const valid = variants
      .map((variant) => cents(variant.price))
      .filter((value) => value !== null);
    if (!images.length)
      findings.push({
        product: product.name,
        kind: "photo_missing",
        message: "Falta fotografia aprobada",
      });
    for (const photo of photos)
      if (!photo.ok)
        findings.push({
          product: product.name,
          kind: "photo_unreachable",
          message: `Fotografia no comprobada: ${photo.status || photo.reason}`,
        });
    if (!variants.length)
      findings.push({
        product: product.name,
        kind: "unavailable",
        message: "Sin variantes comprables en el catalogo publico",
      });
    if (valid.length !== variants.length)
      findings.push({
        product: product.name,
        kind: "invalid_price",
        message: "Hay precios invalidos o no positivos",
      });
    if (valid.length && cents(product.min_price) !== Math.min(...valid))
      findings.push({
        product: product.name,
        kind: "from_mismatch",
        message: "El precio Desde no coincide con las variantes disponibles",
      });
    const combinations = new Set(),
      packages = new Map();
    for (const variant of variants) {
      const options = variant.options || [];
      const key = options
        .map((option) => `${option.option_id}:${option.value_id}`)
        .sort()
        .join("|");
      if (combinations.has(key))
        findings.push({
          product: product.name,
          kind: "duplicate_combination",
          message: "Combinacion de opciones repetida",
        });
      combinations.add(key);
      rows.push([
        product.name,
        product.category_name,
        options
          .map((option) => `${option.option_name}: ${option.value}`)
          .join(" / "),
        variant.price,
        variant.production_points,
        variant.id,
        "Pendiente",
      ]);
      const pack = options.find(
        (option) =>
          option.option_name.trim().toLowerCase() === "package size" &&
          /^\d+$/.test(option.value),
      );
      if (pack) {
        const group = options
          .filter((option) => option !== pack)
          .map((option) => `${option.option_id}:${option.value_id}`)
          .sort()
          .join("|");
        if (!packages.has(group)) packages.set(group, []);
        packages
          .get(group)
          .push({ quantity: Number(pack.value), price: cents(variant.price) });
      }
    }
    for (const group of packages.values()) {
      group.sort((a, b) => a.quantity - b.quantity);
      for (let index = 1; index < group.length; index++) {
        const previous = group[index - 1],
          current = group[index];
        if (
          previous.price !== null &&
          current.price !== null &&
          current.price < previous.price
        )
          findings.push({
            product: product.name,
            kind: "commercial_price_review",
            message: `${current.quantity} unidades cuestan $${(current.price / 100).toFixed(2)}, menos que ${previous.quantity} unidades ($${(previous.price / 100).toFixed(2)}). Confirmar, sin modificar automaticamente.`,
          });
      }
    }
    products.push({ ...product, details: detail.product, variants, photos });
  }
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "catalog.json"),
    `${JSON.stringify({ origin, createdAt, scope: "public products and currently purchasable variants only", products, findings }, null, 2)}\n`,
  );
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const orderedRows = [rows[0], ...rows.slice(1).sort((a, b) =>
    collator.compare(a[0], b[0]) || collator.compare(a[2], b[2]))];
  await writeFile(
    join(output, "prices-for-approval.csv"),
    `\uFEFF${orderedRows.map((row) => row.map(csv).join(",")).join("\r\n")}\r\n`,
  );
  const report = [
    "# Revision del catalogo publico",
    "",
    `Origen: ${origin}`,
    `Consulta UTC: ${createdAt}`,
    "",
    "Solo lectura. Los precios observados no constituyen aprobacion comercial. No incluye productos ocultos ni variantes pausadas.",
    "",
    "| Producto | Desde USD | Variantes | Fotos |",
    "| --- | ---: | ---: | ---: |",
    ...products.map(
      (product) =>
        `| ${cell(product.name)} | ${cell(product.min_price)} | ${product.variants.length} | ${product.photos.length} |`,
    ),
    "",
    "## Hallazgos",
    "",
    ...(findings.length
      ? findings.map(
          (finding) =>
            `- **${cell(finding.product)}:** ${cell(finding.message)}`,
        )
      : ["Sin incidencias detectadas en las comprobaciones automatizadas."]),
    "",
    "## Pendientes de Andrea",
    "",
    "- Aprobar precios, nombres, sabores, tamanos y cantidades del CSV.",
    "- Confirmar fotografias, ingredientes, alergenos, conservacion y porciones antes de publicar esas afirmaciones.",
    "- Confirmar los puntos de preparacion por tamano; no se deducen de los precios.",
    "",
    "Las descripciones y fotografias requieren revision visual. Un HTTP 200 no confirma que una foto corresponda al producto.",
    "",
  ];
  await writeFile(join(output, "review.md"), report.join("\n"));
  console.log(
    JSON.stringify(
      {
        output,
        products: products.length,
        variants: rows.length - 1,
        photos: products.reduce(
          (sum, product) => sum + product.photos.length,
          0,
        ),
        findings,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
