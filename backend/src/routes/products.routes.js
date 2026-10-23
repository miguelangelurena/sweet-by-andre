
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
    getAdminProducts,
    uploadProductImage,
} from "../controllers/product.controllers.js";

import {
    getProductVariants,
    createProductOption,
    createProductOptionValue,
    createProductVariant,
    updateProductVariant,
    getProductOptions,
    updateProductOption,
    updateProductOptionValue
} from "../controllers/productVariant.controllers.js";

import {
    uploadProductImage as uploadMiddleware,
} from "../middleware/uploadProductImage.js";

import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

import { handleUploadError } from "../middleware/handleUploadError.js";

const router = express.Router();

// -------------------------
// PUBLIC PRODUCT ROUTES
// -------------------------

router.get("/products", getProducts);

router.get("/products/:id", getProductById);

router.get("/products/:id/images", getProductImages);

router.get("/products/:id/variants", getProductVariants);

// -------------------------
// ADMIN PRODUCT ROUTES
// -------------------------

router.get(
    "/admin/products",
    requireAuth,
    requireAdmin,
    getAdminProducts
);

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
    "/admin/product-options/:optionId/values",
    requireAuth,
    requireAdmin,
    createProductOptionValue
);


router.post(
    "/admin/products/:id/variants",
    requireAuth,
    requireAdmin,
    createProductVariant
);

router.patch(
    "/admin/variants/:id",
    requireAuth,
    requireAdmin,
    updateProductVariant
);

router.get(
    "/admin/products/:id/options",
    requireAuth,
    requireAdmin,
    getProductOptions
);

router.patch(
    "/admin/product-options/:optionId",
    requireAuth,
    requireAdmin,
    updateProductOption
);

router.patch(
    "/admin/product-option-values/:valueId",
    requireAuth,
    requireAdmin,
    updateProductOptionValue
);

router.post(
    "/admin/products/:id/options",
    requireAuth,
    requireAdmin,
    createProductOption
);

router.get(
    "/admin/products/:id/variants",
    requireAuth,
    requireAdmin,
    getProductVariants
);

// -------------------------
// ADMIN IMAGE ROUTES
// -------------------------

router.post(
    "/products/:id/images",
    requireAuth,
    requireAdmin,
    addProductImage
);

router.post(
    "/products/:id/images/upload",
    requireAuth,
    requireAdmin,
    uploadMiddleware,
    handleUploadError,
    uploadProductImage
);

router.patch(
    "/products/:id/images/:imageId",
    requireAuth,
    requireAdmin,
    updateProductImage
);

router.delete(
    "/products/:id/images/:imageId",
    requireAuth,
    requireAdmin,
    deleteProductImage
);

export default router;
