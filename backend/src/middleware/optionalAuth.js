
import { pool } from "../config/database.js";

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
            SELECT id, role
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

        req.user = result.rows[0];

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
