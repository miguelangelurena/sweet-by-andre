import express from "express";
import { createOrder } from "../controllers/order.controllers.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireSessionCsrf } from "../middleware/sessionCsrf.js";

const router = express.Router();

// Create an order for an authenticated customer.
router.post(
    "/orders",
    requireAuth,
    requireSessionCsrf,
    createOrder
);

export default router;
