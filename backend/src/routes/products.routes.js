import express from "express";

import {
    getProducts,
    getProductById,
    updateProductAvailability,
    createProduct,
    updateProduct,
    addProductImage,
    getProductImages,
    updateProductImage,
    deleteProductImage
} from "../controllers/product.controllers.js";

import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = express.Router();

router.get("/products", getProducts);

router.get("/products/:id", getProductById);

router.post(
    "/products",
    requireAuth,
    requireAdmin,
    createProduct
);

router.patch(
    "/products/:id",
    requireAuth,
    requireAdmin,
    updateProduct
);

router.patch(
    "/products/:id/availability",
    requireAuth,
    requireAdmin,
    updateProductAvailability
);

router.post(
    "/products/:id/images",
    requireAuth,
    requireAdmin,
    addProductImage
);

router.get(
    "/products/:id/images",
    getProductImages
);

router.delete(
    "/products/:id/images/:imageId",
    requireAuth,
    requireAdmin,
    deleteProductImage
);

router.patch(
    "/products/:id/images/:imageId",
    requireAuth,
    requireAdmin,
    updateProductImage
);

export default router;