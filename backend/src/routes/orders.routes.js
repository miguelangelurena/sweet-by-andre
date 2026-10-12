import express from "express";
import { createOrder } from "../controllers/order.controllers.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.post("/orders", requireAuth, createOrder);

export default router;