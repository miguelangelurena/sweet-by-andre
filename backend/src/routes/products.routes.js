import express from "express";
import { getProducts, getProductById, updateProductAvailability } from "../controllers/product.controllers.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = express.Router();

router.get("/products", getProducts);
router.get("/products/:id", getProductById);
router.patch("/products/:id/availability", requireAuth, requireAdmin, updateProductAvailability);

export default router;