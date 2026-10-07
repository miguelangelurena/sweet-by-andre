import express from "express";

import { createCart } from "../controllers/cart.controllers.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.post(
    "/cart",
    requireAuth,
    createCart
);

export default router;