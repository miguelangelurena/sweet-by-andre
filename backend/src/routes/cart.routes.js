
import express from "express";

import {
    createCart,
    addCartItem,
    getCart,
    updateCartItem,
    deleteCartItem,
    acceptCartPriceChanges
} from "../controllers/cart.controllers.js";

import { requireAuth } from "../middleware/requireAuth.js";

import {
    getSessionCsrfToken,
    requireSessionCsrf
} from "../middleware/sessionCsrf.js";

const router = express.Router();

// Obtener el token CSRF de la sesión autenticada.
router.get(
    "/cart/csrf-token",
    requireAuth,
    getSessionCsrfToken
);

// Crear o recuperar carrito.
router.post(
    "/cart",
    requireAuth,
    requireSessionCsrf,
    createCart
);

// Agregar artículo.
router.post(
    "/cart/items",
    requireAuth,
    requireSessionCsrf,
    addCartItem
);

// Consultar carrito.
router.get(
    "/cart",
    requireAuth,
    getCart
);

// Actualizar cantidad.
router.patch(
    "/cart/items/:id",
    requireAuth,
    requireSessionCsrf,
    updateCartItem
);

// Eliminar artículo.
router.delete(
    "/cart/items/:id",
    requireAuth,
    requireSessionCsrf,
    deleteCartItem
);

// Aceptar cambios de precios.
router.patch(
    "/cart/accept-price-changes",
    requireAuth,
    requireSessionCsrf,
    acceptCartPriceChanges
);

export default router;
