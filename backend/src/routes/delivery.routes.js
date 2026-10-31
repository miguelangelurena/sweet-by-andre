import express from "express";
import { pool } from "../config/database.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { requireSessionCsrf } from "../middleware/sessionCsrf.js";
import { requireGuestCart } from "../middleware/requireCart.js";
import { requireGuestCsrf } from "../middleware/guestCsrf.js";
import { DeliveryError, validateDeliveryConfig } from "../services/deliveryPolicy.service.js";
import { publicDeliverySettings, quoteGuestDelivery, readDeliverySettings } from "../services/delivery.service.js";

const router = express.Router();
function handle(fn) { return async (req, res) => {
  try { res.set("Cache-Control", "no-store"); await fn(req, res); }
  catch (error) {
    if (!(error instanceof DeliveryError)) console.error("Delivery request failed:", error);
    res.status(error.status ?? 500).json({ status: "ERROR", code: error.code ?? "DELIVERY_ERROR",
      message: error instanceof DeliveryError ? error.message : "Could not process delivery settings" });
  }
}; }

router.get("/delivery/options", handle(async (_req, res) => {
  res.json({ status: "GOOD", options: await publicDeliverySettings() });
}));
router.post("/guest/delivery/quote", requireGuestCart, requireGuestCsrf, handle(async (req, res) => {
  const quote = await quoteGuestDelivery(req.cartId, req.body ?? {});
  res.json({ status: "GOOD", quote: { ...quote, distance_miles: quote.distance_meters / 1609.344 } });
}));
router.get("/admin/delivery", requireAuth, requireAdmin, handle(async (_req, res) => {
  res.json({ status: "GOOD", settings: await readDeliverySettings(), routing_configured: Boolean(process.env.GOOGLE_ROUTES_API_KEY),
    availability: (await publicDeliverySettings()).days });
}));
router.put("/admin/delivery", requireAuth, requireAdmin, requireSessionCsrf, handle(async (req, res) => {
  const config = validateDeliveryConfig(req.body?.config);
  if (!Number.isSafeInteger(req.body.version)) throw new DeliveryError("Reload the current settings", "DELIVERY_VERSION", 400);
  if (config.delivery_enabled && !process.env.GOOGLE_ROUTES_API_KEY) throw new DeliveryError("Configure GOOGLE_ROUTES_API_KEY on the server before enabling delivery", "DELIVERY_NOT_CONFIGURED", 400);
  const result = await pool.query(`UPDATE delivery_settings SET config=$1,version=version+1,updated_at=NOW()
    WHERE id=TRUE AND version=$2 RETURNING version,config`, [JSON.stringify(config), req.body.version]);
  if (!result.rowCount) throw new DeliveryError("Settings changed in another session. Reload before saving", "DELIVERY_VERSION");
  res.json({ status: "GOOD", settings: result.rows[0] });
}));
export default router;
