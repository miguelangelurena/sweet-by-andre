import { securityError } from "../utils/securityLog.js";

import { pool } from "../config/database.js";
import { validAuthenticatedSession } from "../services/authCredentials.js";
import { expireSession } from "./expireSession.js";

/**
 * Resolves an authenticated user when a session exists.
 *
 * If no authenticated session exists, the request
 * continues as a guest.
 *
 * Does not authorize access to any specific resource.
 */
export const optionalAuth = async (req, res, next) => {
    try {
        const userId = req.session?.userId;

        if (!userId) {
            req.user = null;
            return next();
        }

        const result = await pool.query(
            `
            SELECT id, role, password_hash
            FROM users
            WHERE id = $1
              AND deleted_at IS NULL
            `,
            [userId]
        );

        if (result.rowCount === 0) {
            return expireSession(req, res, "Invalid authenticated session");
        }

        const user = result.rows[0];
        if (!validAuthenticatedSession(req.session, user.password_hash))
            return expireSession(req, res, "Session expired. Please sign in again.");
        req.user = { id: user.id, role: user.role };
        req.session.lastSeenAt = Date.now();

        return next();

    } catch (error) {
        securityError(error, "Optional authentication failed:");

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};
