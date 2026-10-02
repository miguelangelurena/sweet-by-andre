import express from "express";
import { getCategories } from "../controllers/category.controllers.js";
import { createCategory } from "../controllers/category.controllers.js";

const router = express.Router();

router.get("/categories", getCategories);
router.post("/categories", createCategory)

export default router;