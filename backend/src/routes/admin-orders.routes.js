import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { requireSessionCsrf } from "../middleware/sessionCsrf.js";
import {
    getAdminOrders,
    getAdminOrderById,
    acceptAdminOrder,
    advanceAdminOrderStatus,
    cancelUnpaidAdminOrder,
    reviewAdminOrderRefund
} from "../controllers/admin-order.controller.js";

const router = express.Router();

router.get("/orders", requireAuth, requireAdmin, getAdminOrders);
router.get("/orders/:id", requireAuth, requireAdmin, getAdminOrderById);

// Legacy endpoint: retain for compatibility, but protect it with session CSRF.
router.patch("/orders/:id/accept", requireAuth, requireAdmin, requireSessionCsrf, acceptAdminOrder);

// New sequential fulfillment workflow. Never changes payment_status.
router.patch("/orders/:id/status", requireAuth, requireAdmin, requireSessionCsrf, advanceAdminOrderStatus);



router.get("/orders/:id/refund-review", requireAuth, requireAdmin, reviewAdminOrderRefund);

router.patch("/orders/:id/cancel-unpaid", requireAuth, requireAdmin, requireSessionCsrf, cancelUnpaidAdminOrder);

export default router;
