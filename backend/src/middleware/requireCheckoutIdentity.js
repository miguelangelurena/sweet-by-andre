
import { optionalAuth } from "./optionalAuth.js";
import { requireGuestCart } from "./requireCart.js";
import { requireGuestCsrf } from "./guestCsrf.js";
import { requireSessionCsrf } from "./sessionCsrf.js";

/**
 * Identifies and protects a checkout request.
 *
 * Authenticated customer:
 *   - Valid session
 *   - Session CSRF
 *
 * Guest customer:
 *   - Valid guest cart cookie
 *   - Guest CSRF
 *
 * Does not authorize a specific order.
 */
export const requireCheckoutIdentity = [
    optionalAuth,

    (req, res, next) => {
        if (req.user?.id) {
            // Authenticated customers use session CSRF.
            return requireSessionCsrf(req, res, next);
        }

        // Guests must prove ownership of their cart.
        return requireGuestCart(req, res, (error) => {
            if (error) {
                return next(error);
            }

            return requireGuestCsrf(req, res, next);
        });
    }
];
