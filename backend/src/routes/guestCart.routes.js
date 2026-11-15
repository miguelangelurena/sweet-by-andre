import { installUuidParams } from "../middleware/uuidParams.js";

import express from "express";
import { requestRateLimit } from "../middleware/requestRateLimit.js";

import {
    createGuestCart,
    getGuestCart
} from "../controllers/guestCart.controllers.js";

import {
    addCartItem,
    updateCartItem,
    deleteCartItem,
    acceptCartPriceChanges
} from "../controllers/cart.controllers.js";

import {
    requireGuestCart
} from "../middleware/requireCart.js";

import {
    getGuestCsrfToken,
    requireGuestCsrf
} from "../middleware/guestCsrf.js";

import { requireTrustedOrigin } from "../middleware/trustedOrigin.js";

import { createOrder } from "../controllers/order.controllers.js";
import { getGuestOrderStatus } from "../controllers/guestOrderStatus.controllers.js";
import { createCheckoutV2 } from "../controllers/checkoutV2.controllers.js";
import { requireCheckoutOrder } from "../middleware/requireCheckoutOrder.js";

const router = express.Router();
installUuidParams(router);

// Create or recover a guest cart.
router.post(
    "/guest/cart",
    requireTrustedOrigin,
    requestRateLimit({ action: "guest-cart", limit: 30 }),
    createGuestCart
);

// Read an existing guest cart.
router.get(
    "/guest/cart",
    requireGuestCart,
    getGuestCart
);

// Request a CSRF token.
router.get(
    "/guest/cart/csrf-token",
    requireGuestCart,
    getGuestCsrfToken
);

// Add an item.
router.post(
    "/guest/cart/items",
    requireGuestCart,
    requireGuestCsrf,
    addCartItem
);

// Update an item's quantity.
router.patch(
    "/guest/cart/items/:id",
    requireGuestCart,
    requireGuestCsrf,
    updateCartItem
);

// Delete an item.
router.delete(
    "/guest/cart/items/:id",
    requireGuestCart,
    requireGuestCsrf,
    deleteCartItem
);

// Accept current variant prices.
router.patch(
    "/guest/cart/accept-price-changes",
    requireGuestCart,
    requireGuestCsrf,
    acceptCartPriceChanges
);


// Create an order for a guest customer.
router.post(
    "/guest/orders",
    requireGuestCart,
    requireGuestCsrf,
    requestRateLimit({ action: "order", limit: 60, identityLimit: 10 }),
    createOrder
);


// Authorized, read-only payment status for an existing guest order.
router.get("/guest/orders/:orderId/status", requireGuestCart, getGuestOrderStatus);

// Match guest order creation even when the browser also has an admin session.
// Authorize the guest cookie, guest CSRF token, and order ownership together.
router.post(
    "/guest/payments/checkout",
    requireGuestCart,
    requireGuestCsrf,
    requestRateLimit({ action: "checkout", limit: 60, identityLimit: 20 }),
    requireCheckoutOrder,
    createCheckoutV2
);

export default router;
