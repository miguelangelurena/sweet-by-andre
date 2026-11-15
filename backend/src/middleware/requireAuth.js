import { securityError } from "../utils/securityLog.js";
import { pool } from "../config/database.js";
import { validAuthenticatedSession } from "../services/authCredentials.js";
import { expireSession } from "./expireSession.js";

export const requireAuth = async (req, res, next) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                status: "ERROR",
                message: "Not authenticated"
            });
        }

        const existingUser = await pool.query(
            `
    SELECT id, role, password_hash
    FROM users
    WHERE id = $1
    AND deleted_at IS NULL
    `,
            [req.session.userId]
        );

        if (existingUser.rows.length === 0) {
            return expireSession(req, res, "User not found");
        }

        const user = existingUser.rows[0];
        if (!validAuthenticatedSession(req.session, user.password_hash)) {
            return expireSession(req, res, "Session expired. Please sign in again.");
        }
        req.user = { id: user.id, role: user.role };
        req.session.lastSeenAt = Date.now();

        next();

    } catch (error) {
        securityError(error, "requireAuth.js");

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};
