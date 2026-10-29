
import { pool } from "../config/database.js";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Authorizes access to an existing order for Checkout.
 *
 * IMPORTANT:
 * - requireCheckoutIdentity must run first.
 * - Ownership is verified against PostgreSQL.
 * - A valid order_id alone never grants access.
 * - This middleware does not reserve inventory or call Stripe.
 */
export const requireCheckoutOrder = async (req, res, next) => {
    try {
        const orderId = req.body?.order_id;

        if (
            typeof orderId !== "string" ||
            !UUID_RE.test(orderId)
        ) {
            return res.status(400).json({
                status: "ERROR",
                message: "Valid order_id is required"
            });
        }

        const userId = req.user?.id ?? null;
        const guestCartId = req.cartId ?? null;

        // Require exactly one authorized identity.
        if (Boolean(userId) === Boolean(guestCartId)) {
            return res.status(401).json({
                status: "ERROR",
                message: "Checkout identity not authorized"
            });
        }

        const orderResult = userId
            ? await pool.query(
                `
                SELECT
                    id,
                    user_id,
                    guest_cart_id,
                    total,
                    payment_status,
                    order_status
                FROM orders
                WHERE id = $1
                  AND user_id = $2
                  AND guest_cart_id IS NULL
                `,
                [orderId, userId]
            )
            : await pool.query(
                `
                SELECT
                    id,
                    user_id,
                    guest_cart_id,
                    total,
                    payment_status,
                    order_status
                FROM orders
                WHERE id = $1
                  AND guest_cart_id = $2
                  AND user_id IS NULL
                `,
                [orderId, guestCartId]
            );

        if (!orderResult.rowCount) {
            return res.status(404).json({
                status: "ERROR",
                message: "Order not found"
            });
        }

        // Provide the authorized order to subsequent middleware.
        req.checkoutOrder = orderResult.rows[0];

        return next();

    } catch (error) {
        console.error(
            "Checkout order authorization failed:",
            error
        );

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};
