import express from "express";

import { createCart, addCartItem } from "../controllers/cart.controllers.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.post("/cart", requireAuth, createCart);

router.post("/cart/items", requireAuth, addCartItem);

export default router;