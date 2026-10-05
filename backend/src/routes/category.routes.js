import express from "express";

import {
    getCategories,
    createCategory,
    updateCategory,
    updateCategoryStatus
} from "../controllers/category.controllers.js";

import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = express.Router();

router.get("/categories", getCategories);

router.post(
    "/categories",
    requireAuth,
    requireAdmin,
    createCategory
);

router.patch(
    "/categories/:id",
    requireAuth,
    requireAdmin,
    updateCategory
);

router.patch(
    "/categories/:id/status",
    requireAuth,
    requireAdmin,
    updateCategoryStatus
);

export default router;