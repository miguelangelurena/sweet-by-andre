import { pool } from "../config/database.js";

export const requireAuth = async (req, res, next) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                status: "ERROR",
                message: "Not authenticated"
            });
        }

        const existingUser = await pool.query(
            `SELECT id
             FROM users
             WHERE id = $1
             AND deleted_at IS NULL`,
            [req.session.userId]
        );

        if (existingUser.rows.length === 0) {
            return res.status(401).json({
                status: "ERROR",
                message: "User not found"
            });
        }

        req.user = existingUser.rows[0];

        next();

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};