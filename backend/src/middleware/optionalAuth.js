
import { pool } from "../config/database.js";
import { credentialVersion } from "../services/authCredentials.js";

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
            return res.status(401).json({
                status: "ERROR",
                message: "Invalid authenticated session"
            });
        }

        const user = result.rows[0];
        const version = credentialVersion(user.password_hash);
        if (!version || req.session.credentialVersion !== version)
            return res.status(401).json({ status: "ERROR", message: "Session expired. Please sign in again." });
        req.user = { id: user.id, role: user.role };

        return next();

    } catch (error) {
        console.error(
            "Optional authentication failed:",
            error
        );

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};
