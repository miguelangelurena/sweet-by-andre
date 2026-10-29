import { pool } from "../config/database.js";

const SLUGS = new Set(["valentines", "thanksgiving", "christmas"]);
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// Returns only published collections; it does NOT modify product prices.
export async function getSeasonalCollections(_req, res) {
  try {
    const result = await pool.query(`
      SELECT c.slug, c.title, c.description,
        COALESCE(array_agg(cp.product_id ORDER BY cp.product_id)
          FILTER (WHERE cp.product_id IS NOT NULL AND p.is_available = TRUE), ARRAY[]::uuid[]) AS product_ids
      FROM seasonal_collections c
      LEFT JOIN seasonal_collection_products cp ON cp.collection_slug = c.slug
      LEFT JOIN products p ON p.id = cp.product_id
      WHERE c.is_published = TRUE
      GROUP BY c.slug, c.title, c.description
      ORDER BY CASE c.slug WHEN 'valentines' THEN 1 WHEN 'thanksgiving' THEN 2 ELSE 3 END
    `);
    return res.json({ status: "GOOD", collections: result.rows });
  } catch (error) {
    console.error("Public seasonal collections error:", error);
    return res.status(500).json({ status: "ERROR", message: "Could not load seasonal collections" });
  }
}

export async function getAdminSeasonalCollections(_req, res) {
  try {
    const result = await pool.query(`
      SELECT c.slug, c.title, c.description, c.is_published,
        COALESCE(array_agg(cp.product_id ORDER BY cp.product_id)
         FILTER (WHERE cp.product_id IS NOT NULL), ARRAY[]::uuid[]) AS product_ids
      FROM seasonal_collections c LEFT JOIN seasonal_collection_products cp
        ON c.slug = cp.collection_slug
      GROUP BY c.slug, c.title, c.description, c.is_published
      ORDER BY CASE c.slug WHEN 'valentines' THEN 1 WHEN 'thanksgiving' THEN 2 ELSE 3 END
    `);
    return res.json({ status: "GOOD", collections: result.rows });
  } catch (error) {
    console.error("Admin seasonal collections error:", error);
    return res.status(500).json({ status: "ERROR", message: "Could not load seasonal collections" });
  }
}

export async function updateAdminSeasonalCollection(req, res) {
  const slug = req.params.slug;
  const { title, description, is_published: published, product_ids: ids } = req.body ?? {};
  if (!SLUGS.has(slug) || typeof title !== "string" || !title.trim() || title.length > 90 ||
    typeof description !== "string" || description.length > 350 ||
    typeof published !== "boolean" || !Array.isArray(ids) || ids.length > 150 ||
    !ids.every(id => typeof id === "string" && UUID.test(id)) || new Set(ids).size !== ids.length) {
    return res.status(400).json({ status: "ERROR", message: "Invalid seasonal collection fields" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Verify product IDs exist and cannot reference deleted products.
    const found = await client.query(`SELECT id FROM products WHERE id = ANY($1::uuid[])`, [ids]);
    if (found.rowCount !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ status: "ERROR", message: "Unknown product selected" });
    }
    const updated = await client.query(`
      UPDATE seasonal_collections SET title = $2, description = $3, is_published = $4, updated_at = NOW()
      WHERE slug = $1 RETURNING slug, title, description, is_published
    `, [slug, title.trim(), description.trim(), published]);
    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ status: "ERROR", message: "Collection not found; run the migration" });
    }
    await client.query("DELETE FROM seasonal_collection_products WHERE collection_slug = $1", [slug]);
    if (ids.length) await client.query(`
      INSERT INTO seasonal_collection_products(collection_slug, product_id)
      SELECT $1, unnest($2::uuid[])
    `, [slug, ids]);
    await client.query("COMMIT");
    return res.json({ status: "GOOD", collection: { ...updated.rows[0], product_ids: ids } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Update seasonal collection error:", error);
    return res.status(500).json({ status: "ERROR", message: "Could not update collection" });
  } finally {
    client.release();
  }
}
