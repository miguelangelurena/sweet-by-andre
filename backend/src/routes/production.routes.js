import express from "express";
import { pool } from "../config/database.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { requireSessionCsrf } from "../middleware/sessionCsrf.js";
import {
  productionOptions,
  ProductionError,
  validateProductionConfig,
} from "../services/production.service.js";

const router = express.Router();
const handle = (fn) => async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    await fn(req, res);
  } catch (error) {
    if (!(error instanceof ProductionError))
      console.error("Production request failed:", error);
    res
      .status(error instanceof ProductionError ? error.status : 500)
      .json({
        status: "ERROR",
        code:
          error instanceof ProductionError ? error.code : "PRODUCTION_ERROR",
        message:
          error instanceof ProductionError
            ? error.message
            : "Could not process preparation settings",
      });
  }
};
router.get(
  "/production/options",
  handle(async (_req, res) =>
    res.json({ status: "GOOD", options: await productionOptions() }),
  ),
);
router.get(
  "/admin/production",
  requireAuth,
  requireAdmin,
  handle(async (_req, res) => {
    const products =
      await pool.query(`SELECT p.id,p.name,p.inventory_mode,p.is_available,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'production_points',v.production_points,'stock',v.stock,'is_available',v.is_available,
      'label',COALESCE((SELECT string_agg(pov.value,' / ' ORDER BY po.display_order,po.name)
        FROM product_variant_values pvv JOIN product_option_values pov ON pov.id=pvv.option_value_id
        JOIN product_options po ON po.id=pvv.option_id WHERE pvv.variant_id=v.id),'Standard')) ORDER BY v.created_at,v.id)
      FROM product_variants v WHERE v.product_id=p.id),'[]'::jsonb) AS variants
    FROM products p ORDER BY p.name,p.id`);
    res.json({
      status: "GOOD",
      settings: await productionOptions(true),
      products: products.rows,
    });
  }),
);
router.put(
  "/admin/production",
  requireAuth,
  requireAdmin,
  requireSessionCsrf,
  handle(async (req, res) => {
    const config = validateProductionConfig(req.body?.config);
    if (!Number.isSafeInteger(req.body.version))
      throw new ProductionError(
        "Reload settings before saving",
        "PRODUCTION_VERSION",
        400,
      );
    const saved = await pool.query(
      `UPDATE production_settings SET config=$1,version=version+1,updated_at=NOW()
    WHERE id=TRUE AND version=$2 RETURNING version,config`,
      [JSON.stringify(config), req.body.version],
    );
    if (!saved.rowCount)
      throw new ProductionError(
        "Settings changed in another session. Reload before saving",
        "PRODUCTION_VERSION",
      );
    res.json({ status: "GOOD", settings: saved.rows[0] });
  }),
);
router.put(
  "/admin/production/products/:id",
  requireAuth,
  requireAdmin,
  requireSessionCsrf,
  handle(async (req, res) => {
    const { inventory_mode, variants } = req.body ?? {};
    if (
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(req.params.id) ||
      !["stock", "made_to_order"].includes(inventory_mode) ||
      !Array.isArray(variants) ||
      variants.length > 1000 ||
      variants.some(
        (v) =>
          !v ||
          !Number.isInteger(v.production_points) ||
          v.production_points < 1 ||
          v.production_points > 10000,
      )
    ) {
      throw new ProductionError(
        "Choose a sales mode and positive preparation points for every variant",
        "PRODUCTION_PRODUCT",
        400,
      );
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const p = await client.query(
        "SELECT id FROM products WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!p.rowCount)
        throw new ProductionError(
          "Product not found",
          "PRODUCTION_PRODUCT",
          404,
        );
      const existing = await client.query(
        "SELECT id FROM product_variants WHERE product_id=$1 ORDER BY id FOR UPDATE",
        [req.params.id],
      );
      const supplied = new Map(
        variants.map((v) => [v.id, v.production_points]),
      );
      if (
        supplied.size !== variants.length ||
        existing.rowCount !== supplied.size ||
        existing.rows.some((v) => !supplied.has(v.id))
      )
        throw new ProductionError(
          "Product variants changed. Reload before saving",
          "PRODUCTION_PRODUCT",
        );
      for (const variant of existing.rows)
        await client.query(
          "UPDATE product_variants SET production_points=$2,updated_at=NOW() WHERE id=$1",
          [variant.id, supplied.get(variant.id)],
        );
      await client.query(
        "UPDATE products SET inventory_mode=$2,updated_at=NOW() WHERE id=$1",
        [req.params.id, inventory_mode],
      );
      await client.query("COMMIT");
      res.json({ status: "GOOD" });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);
export default router;
