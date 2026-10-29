import express from "express";

import {
    getCategories,
    createCategory,
    updateCategory,
    updateCategoryStatus,
    getAdminCategories
} from "../controllers/category.controllers.js";

import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { requireSessionCsrf } from "../middleware/sessionCsrf.js";

const router = express.Router();

router.get("/categories", getCategories);
router.get("/admin/categories", requireAuth, requireAdmin, getAdminCategories);

router.post(
    "/categories",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
    createCategory
);

router.patch(
    "/categories/:id",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
    updateCategory
);

router.patch(
    "/categories/:id/status",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
    updateCategoryStatus
);

export default router;