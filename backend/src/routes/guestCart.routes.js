import express from "express";

import {
    createGuestCart,
    getGuestCart,
} from "../controllers/guestCart.controllers.js";

import {
    requireGuestCart
} from "../middleware/requireCart.js";

import {
    addCartItem,
    updateCartItem,
    deleteCartItem,
    acceptCartPriceChanges
} from "../controllers/cart.controllers.js";

const router = express.Router();

router.post("/guest/cart", createGuestCart);

router.get(
    "/guest/cart",
    requireGuestCart,
    getGuestCart
);

router.post(
    "/guest/cart/items",
    requireGuestCart,
    addCartItem
);

router.patch(
    "/guest/cart/items/:id",
    requireGuestCart,
    updateCartItem
);

router.delete(
    "/guest/cart/items/:id",
    requireGuestCart,
    deleteCartItem
);

router.patch(
    "/guest/cart/accept-price-changes",
    requireGuestCart,
    acceptCartPriceChanges
);

export default router;