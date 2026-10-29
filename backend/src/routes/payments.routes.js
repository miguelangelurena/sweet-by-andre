
import express from "express";

import {
    createCheckoutV2
} from "../controllers/checkoutV2.controllers.js";

import {
    requireCheckoutIdentity
} from "../middleware/requireCheckoutIdentity.js";

import {
    requireCheckoutOrder
} from "../middleware/requireCheckoutOrder.js";

/**
 * Builds the Checkout router.
 *
 * The optional controller allows HTTP tests
 * without calling the real Stripe API.
 */
export function createPaymentsRouter({
    checkoutController = createCheckoutV2
} = {}) {
    const router = express.Router();

    router.post(
        "/payments/checkout",
        ...requireCheckoutIdentity,
        requireCheckoutOrder,
        checkoutController
    );

    return router;
}

// Production router uses the real controller.
export default createPaymentsRouter();
