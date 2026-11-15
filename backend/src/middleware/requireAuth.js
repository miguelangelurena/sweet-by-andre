import { pool } from "../config/database.js";
import { credentialVersion } from "../services/authCredentials.js";

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
            return res.status(401).json({
                status: "ERROR",
                message: "User not found"
            });
        }

        const user = existingUser.rows[0];
        const version = credentialVersion(user.password_hash);
        if (!version || req.session.credentialVersion !== version) {
            return res.status(401).json({ status: "ERROR", message: "Session expired. Please sign in again." });
        }
        req.user = { id: user.id, role: user.role };

        next();

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};
