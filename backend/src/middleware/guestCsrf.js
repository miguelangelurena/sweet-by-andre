
import {
    createHmac,
    timingSafeEqual
} from "node:crypto";

import {
    GUEST_CART_COOKIE,
    hashGuestToken
} from "../utils/guestCart.js";

const CSRF_HEADER = "x-csrf-token";

const getCsrfSecret = () => {
    const secret = process.env.CSRF_SECRET;

    if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
        throw new Error(
            "CSRF_SECRET must contain 64 hexadecimal characters"
        );
    }

    return Buffer.from(secret, "hex");
};

const generateCsrfToken = (guestToken) => {
    const guestHash = hashGuestToken(guestToken);

    return createHmac("sha256", getCsrfSecret())
        .update(`sweetbyandre:guest-cart:csrf:${guestHash}`)
        .digest("hex");
};

// GET: return a CSRF token for an authorized guest cart.
export const getGuestCsrfToken = (req, res) => {
    try {
        const guestToken = req.cookies?.[GUEST_CART_COOKIE];

        // requireGuestCart must run before this handler.
        if (!req.cartId || !guestToken) {
            return res.status(401).json({
                status: "ERROR",
                message: "Guest cart not authorized"
            });
        }

        res.set("Cache-Control", "no-store");

        return res.status(200).json({
            status: "GOOD",
            csrf_token: generateCsrfToken(guestToken)
        });

    } catch (error) {
        console.error("CSRF token generation failed:", error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};

// Protect POST, PATCH and DELETE operations.
export const requireGuestCsrf = (req, res, next) => {
    try {
        const guestToken = req.cookies?.[GUEST_CART_COOKIE];
        const suppliedToken = req.get(CSRF_HEADER);

        if (
            !req.cartId ||
            typeof guestToken !== "string" ||
            typeof suppliedToken !== "string" ||
            !/^[a-f0-9]{64}$/i.test(suppliedToken)
        ) {
            return res.status(403).json({
                status: "ERROR",
                message: "Missing or invalid CSRF token"
            });
        }

        const expectedToken = generateCsrfToken(guestToken);

        const expectedBuffer = Buffer.from(
            expectedToken,
            "hex"
        );

        const suppliedBuffer = Buffer.from(
            suppliedToken,
            "hex"
        );

        if (
            expectedBuffer.length !== suppliedBuffer.length ||
            !timingSafeEqual(expectedBuffer, suppliedBuffer)
        ) {
            return res.status(403).json({
                status: "ERROR",
                message: "Missing or invalid CSRF token"
            });
        }

        next();

    } catch (error) {
        console.error("CSRF validation failed:", error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};
