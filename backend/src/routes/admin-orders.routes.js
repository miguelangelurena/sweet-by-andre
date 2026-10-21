
import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { getAdminOrders, getAdminOrderById, acceptAdminOrder } from "../controllers/admin-order.controller.js";

const router = express.Router();

router.get("/orders", requireAuth, requireAdmin, getAdminOrders);
router.get("/orders/:id", requireAuth, requireAdmin, getAdminOrderById);
router.patch("/orders/:id/accept", requireAuth, requireAdmin, acceptAdminOrder);

export default router;
