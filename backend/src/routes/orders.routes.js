import { requestRateLimit } from "../middleware/requestRateLimit.js";

import express from "express";

import {
    createOrder
} from "../controllers/order.controllers.js";

import {
    requireCheckoutIdentity
} from "../middleware/requireCheckoutIdentity.js";

const router = express.Router();

/**
 * Creates pending orders for authenticated
 * customers and guest customers.
 *
 * Security:
 * - Authenticated users require session CSRF.
 * - Guests require a valid cart and guest CSRF.
 * - createOrder verifies cart ownership in PostgreSQL.
 */
router.post(
    "/orders",
    ...requireCheckoutIdentity,
    requestRateLimit({ action: "order", limit: 60, identityLimit: 10 }),
    createOrder
);

export default router;
