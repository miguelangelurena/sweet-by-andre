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
    deleteProductImage,
    getAdminProducts
} from "../controllers/product.controllers.js";

import { uploadProductImage } from "../controllers/product.controllers.js";
import { uploadProductImage as uploadMiddleware } from "../middleware/uploadProductImage.js";

import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

import { handleUploadError } from "../middleware/handleUploadError.js";

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

router.post(
    "/products/:id/images/upload",
    requireAuth,
    requireAdmin,
    uploadMiddleware,
    uploadProductImage
);

router.post(
    "/products/:id/images/upload",
    requireAuth,
    requireAdmin,
    uploadMiddleware,
    handleUploadError,
    uploadProductImage
);

router.get(
    "/admin/products",
    requireAuth,
    requireAdmin,
    getAdminProducts
);

export default router;