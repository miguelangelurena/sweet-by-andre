
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
