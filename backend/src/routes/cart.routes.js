import express from "express";

import { createCart, addCartItem, getCart, updateCartItem, deleteCartItem } from "../controllers/cart.controllers.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.post("/cart", requireAuth, createCart);
router.post("/cart/items", requireAuth, addCartItem);
router.get("/cart", requireAuth, getCart);
router.patch("/cart/items/:id", requireAuth, updateCartItem);
router.delete("/cart/items/:id", requireAuth, deleteCartItem);

export default router;