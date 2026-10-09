import express from "express";

import { createCart, addCartItem, getCart } from "../controllers/cart.controllers.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.post("/cart", requireAuth, createCart);
router.post("/cart/items", requireAuth, addCartItem);
router.get("/cart", requireAuth, getCart);

export default router;