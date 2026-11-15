import { requestRateLimit } from "../middleware/requestRateLimit.js";
import { installUuidParams } from "../middleware/uuidParams.js";

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
import { requireSessionCsrf } from "../middleware/sessionCsrf.js";

import { handleUploadError } from "../middleware/handleUploadError.js";

const router = express.Router();
installUuidParams(router);

// -------------------------
// PUBLIC PRODUCT ROUTES
// -------------------------

router.get("/products", getProducts);

router.get("/products/:id", getProductById);

router.get("/products/:id/images", getProductImages);
router.get("/admin/products/:id/images", requireAuth, requireAdmin, getProductImages);

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
    requireSessionCsrf,
    createProduct
);

router.patch(
    "/products/:id",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
    updateProduct
);

router.patch(
    "/products/:id/availability",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
    updateProductAvailability
);

router.post(
    "/admin/product-options/:optionId/values",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
    createProductOptionValue
);


router.post(
    "/admin/products/:id/variants",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
    createProductVariant
);

router.patch(
    "/admin/variants/:id",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
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
    requireSessionCsrf,
    updateProductOption
);

router.patch(
    "/admin/product-option-values/:valueId",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
    updateProductOptionValue
);

router.post(
    "/admin/products/:id/options",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
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
    requireSessionCsrf,
    addProductImage
);

router.post(
    "/products/:id/images/upload",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
    requestRateLimit({ action: "upload", limit: 20, identityLimit: 20 }),
    uploadMiddleware,
    handleUploadError,
    uploadProductImage
);

router.patch(
    "/products/:id/images/:imageId",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
    updateProductImage
);

router.delete(
    "/products/:id/images/:imageId",
    requireAuth,
    requireAdmin,
    requireSessionCsrf,
    deleteProductImage
);

export default router;
