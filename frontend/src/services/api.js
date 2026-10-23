
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
