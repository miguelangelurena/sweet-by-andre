const API_URL = import.meta.env.VITE_API_URL ?? "/api";

export async function apiRequest(endpoint, options = {}) {
    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...options.headers
        }
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(
            data?.message || `Request failed: ${response.status}`
        );
    }

    return data;
}

export function getProducts() {
    return apiRequest("/products");
}

export function getProductById(productId) {
    return apiRequest(`/products/${encodeURIComponent(productId)}`);
}

export function getCategories() {
    return apiRequest("/categories");
}

export function getCurrentUser() {
    return apiRequest("/auth/me");
}

export function login(email, password) {
    return apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
    });
}

export function getAdminProducts() {
    return apiRequest("/admin/products");
}

export function createProduct(productData) {
    return apiRequest("/products", {
        method: "POST",
        body: JSON.stringify(productData),
    });
}

export async function uploadProductImage(productId, file) {
    const formData = new FormData();
    formData.append("image", file);

    const response = await fetch(
        `/api/products/${productId}/images/upload`,
        {
            method: "POST",
            credentials: "include",
            body: formData,
        }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(
            data?.message || "Failed to upload product image"
        );
    }

    return data;
}

export function updateProduct(productId, productData) {
    return apiRequest(`/products/${productId}`, {
        method: "PATCH",
        body: JSON.stringify(productData),
    });
}

export function updateProductAvailability(productId, isAvailable) {
    return apiRequest(`/products/${productId}/availability`, {
        method: "PATCH",
        body: JSON.stringify({
            is_available: isAvailable,
        }),
    });
}


export function getProductImages(productId) {
    return apiRequest(`/products/${productId}/images`);
}

export function setMainProductImage(productId, imageId) {
    return apiRequest(
        `/products/${productId}/images/${imageId}`,
        {
            method: "PATCH",
            body: JSON.stringify({
                display_order: 1,
            }),
        }
    );
}

export function deleteProductImage(productId, imageId) {
    return apiRequest(
        `/products/${productId}/images/${imageId}`,
        {
            method: "DELETE",
        }
    );
}

// ========================================
// PRODUCT OPTIONS
// ========================================

// Get all options and values for a product (Admin)
export function getAdminProductOptions(productId) {
    return apiRequest(
        `/admin/products/${encodeURIComponent(productId)}/options`
    );
}

// Create a new option (Size, Flavor, Package Size...)
export function createProductOption(productId, name) {
    return apiRequest(
        `/admin/products/${encodeURIComponent(productId)}/options`,
        {
            method: "POST",
            body: JSON.stringify({ name }),
        }
    );
}

// Update an existing option
export function updateProductOption(optionId, optionData) {
    return apiRequest(
        `/admin/product-options/${encodeURIComponent(optionId)}`,
        {
            method: "PATCH",
            body: JSON.stringify(optionData),
        }
    );
}


// ========================================
// PRODUCT OPTION VALUES
// ========================================

// Create a value (4", 6", Oreo, Vanilla...)
export function createProductOptionValue(optionId, value) {
    return apiRequest(
        `/admin/product-options/${encodeURIComponent(optionId)}/values`,
        {
            method: "POST",
            body: JSON.stringify({ value }),
        }
    );
}

// Update a value or its availability
export function updateProductOptionValue(valueId, valueData) {
    return apiRequest(
        `/admin/product-option-values/${encodeURIComponent(valueId)}`,
        {
            method: "PATCH",
            body: JSON.stringify(valueData),
        }
    );
}


// ========================================
// PRODUCT VARIANTS
// ========================================

// Get every variant, including unavailable ones (Admin)
export function getAdminProductVariants(productId) {
    return apiRequest(
        `/admin/products/${encodeURIComponent(productId)}/variants`
    );
}

// Get only available variants (Public)
export function getProductVariants(productId) {
    return apiRequest(
        `/products/${encodeURIComponent(productId)}/variants`
    );
}

// Create a new variant with its options and price
export function createProductVariant(productId, variantData) {
    return apiRequest(
        `/admin/products/${encodeURIComponent(productId)}/variants`,
        {
            method: "POST",
            body: JSON.stringify(variantData),
        }
    );
}

// Update variant price, stock, or availability
export function updateProductVariant(variantId, variantData) {
    return apiRequest(
        `/admin/variants/${encodeURIComponent(variantId)}`,
        {
            method: "PATCH",
            body: JSON.stringify(variantData),
        }
    );
}

// ========================================
// GUEST CHECKOUT / PENDING ORDERS
// ========================================

export function getGuestCart() {
    return apiRequest("/guest/cart");
}

export function ensureGuestCart() {
    return apiRequest("/guest/cart", { method: "POST" });
}

export async function getGuestCsrfToken() {
    const response = await apiRequest("/guest/cart/csrf-token");
    if (!response?.csrf_token) {
        throw new Error("Could not obtain the security token.");
    }
    return response.csrf_token;
}

export async function createGuestPendingOrder(orderData, idempotencyKey) {
    if (!idempotencyKey) throw new Error("Missing order request identifier");
    const csrfToken = await getGuestCsrfToken();
    return apiRequest("/guest/orders", {
        method: "POST",
        headers: {
            "X-CSRF-Token": csrfToken,
            "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(orderData),
    });
}

// The backend independently checks ownership, CSRF and payment activation.
export async function startGuestStripeCheckout(orderId) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(orderId ?? "")) {
        throw new Error("Invalid order identifier.");
    }
    const csrfToken = await getGuestCsrfToken();
    return apiRequest("/guest/payments/checkout", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ order_id: orderId }),
    });
}


// Admin categories: all mutations require session CSRF.
export function getAdminCategories() { return apiRequest("/admin/categories"); }
export async function withAdminCsrf(endpoint, { method, body }) {
    const token = await apiRequest("/cart/csrf-token");
    if (!token?.csrf_token) throw new Error("Session security token unavailable");
    return apiRequest(endpoint, { method, headers: { "X-CSRF-Token": token.csrf_token }, body: JSON.stringify(body) });
}
export const createAdminCategory = (data) => withAdminCsrf("/categories", { method: "POST", body: data });
export const renameAdminCategory = (id, data) => withAdminCsrf(`/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: data });
export const setAdminCategoryActive = (id, is_active) => withAdminCsrf(`/categories/${encodeURIComponent(id)}/status`, { method: "PATCH", body: { is_active } });
