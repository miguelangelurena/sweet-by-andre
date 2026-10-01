import { pool } from "../config/database.js";

export const getCategories = async (req, res) => {
    try {
        const result = await pool.query(
            `
            SELECT id, name, description
            FROM categories
            WHERE is_active = TRUE
            ORDER BY name
            `
        );

        return res.status(200).json({
            status: "GOOD",
            categories: result.rows
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};