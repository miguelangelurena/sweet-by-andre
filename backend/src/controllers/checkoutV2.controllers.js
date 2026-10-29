
import { stripe } from "../config/stripe.js";

import {
    startDatabaseCheckout
} from "../services/checkoutDatabase.service.js";

/**
 * Creates a Checkout HTTP controller.
 *
 * Dependency injection allows safe testing
 * without calling Stripe or PostgreSQL.
 */
export function makeCheckoutV2Controller({
    startCheckout = startDatabaseCheckout,
    stripeClient = stripe
} = {}) {
    return async function createCheckoutV2(req, res) {
        try {
            const orderId = req.checkoutOrder?.id;

            const userId = req.user?.id ?? null;
            const guestCartId = req.cartId ?? null;

            if (!orderId) {
                return res.status(403).json({
                    status: "ERROR",
                    message: "Checkout order is not authorized"
                });
            }

            if (Boolean(userId) === Boolean(guestCartId)) {
                return res.status(401).json({
                    status: "ERROR",
                    message: "Invalid checkout identity"
                });
            }

            const frontendUrl = process.env.FRONTEND_URL;

            if (!frontendUrl) {
                throw new Error(
                    "FRONTEND_URL is not configured"
                );
            }

            const result = await startCheckout(
                {
                    orderId,
                    userId,
                    guestCartId,
                    frontendUrl
                },
                stripeClient
            );

            if (result.status === "reconciliation_required") {
                return res.status(409).json({
                    status: "RECONCILIATION_REQUIRED",
                    message:
                        "Checkout is being verified. " +
                        "Please try again later.",
                    attemptId: result.attemptId
                });
            }

            if (
                result.status !== "ready" ||
                typeof result.checkoutUrl !== "string"
            ) {
                throw new Error("Unexpected Checkout result");
            }

            return res.status(200).json({
                status: "SUCCESS",
                checkoutUrl: result.checkoutUrl
            });

        } catch (error) {
            console.error("Checkout V2 failed:", error);

            return res.status(500).json({
                status: "ERROR",
                message: "Could not initialize Checkout"
            });
        }
    };
}

// Production export: uses the actual services and Stripe client.
const productionCheckoutController = makeCheckoutV2Controller();

// Independent server-side kill switch. The frontend flag is NOT a security boundary.
// Never enable until the bakery has an authorized Stripe TEST configuration.
export const createCheckoutV2 = (req, res) => {
    if (process.env.ENABLE_STRIPE_CHECKOUT !== "true") {
        return res.status(503).json({
            status: "PAYMENTS_DISABLED",
            message: "Online payments are not available yet"
        });
    }
    return productionCheckoutController(req, res);
};
