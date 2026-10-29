import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { getAdminDashboard } from "../controllers/adminDashboard.controllers.js";
const router = Router();
router.get("/dashboard/summary", requireAuth, requireAdmin, getAdminDashboard);
export default router;
