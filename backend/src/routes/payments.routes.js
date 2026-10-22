
import express from "express";
import { createCheckoutSession } from "../controllers/payment.controllers.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.post("/payments/checkout", requireAuth, createCheckoutSession);

export default router;
