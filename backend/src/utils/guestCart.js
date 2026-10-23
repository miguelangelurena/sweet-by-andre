import { randomBytes, createHash } from "node:crypto";

export const GUEST_CART_COOKIE = "sweetbyandre_guest_cart";

export const generateGuestToken = () => {
    return randomBytes(32).toString("hex");
};

export const hashGuestToken = (token) => {
    return createHash("sha256")
        .update(token)
        .digest("hex");
};

export const guestCartCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30
};