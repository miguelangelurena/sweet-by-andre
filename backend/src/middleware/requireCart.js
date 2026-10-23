import { pool } from "../config/database.js";

import {
    GUEST_CART_COOKIE,
    hashGuestToken
} from "../utils/guestCart.js";

export const requireGuestCart = async (req, res, next) => {
    try {
        const token = req.cookies?.[GUEST_CART_COOKIE];

        if (
            typeof token !== "string" ||
            !/^[a-f0-9]{64}$/i.test(token)
        ) {
            return res.status(401).json({
                status: "ERROR",
                message: "Guest cart cookie is missing or invalid"
            });
        }

        const tokenHash = hashGuestToken(token);

        const result = await pool.query(
            `
            SELECT id
            FROM cart
            WHERE guest_token_hash = $1
              AND user_id IS NULL;
            `,
            [tokenHash]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Guest cart not found"
            });
        }

        req.cartId = result.rows[0].id;

        next();

    } catch (error) {
        console.error("Error resolving guest cart:", error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};