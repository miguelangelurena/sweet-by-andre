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

export const createCategory = async (req, res) => {
    try {
        const {
            name,
            description
        } = req.body;

        if (typeof name !== "string" || name.trim() === "") {
            return res.status(400).json({
                status: "ERROR",
                message: "name must be a non-empty string"
            });
        }

        if (description !== undefined && typeof description !== "string") {
            return res.status(400).json({
                status: "ERROR",
                message: "description must be a string"
            });
        }

        const cleanName = name.trim();

        const cleanDescription =
            description === undefined
                ? null
                : description.trim();

        const result = await pool.query(
            `
            INSERT INTO categories (
                name,
                description
            )
            VALUES ($1, $2)
            RETURNING
                id,
                name,
                description,
                is_active,
                created_at;
            `,
            [cleanName, cleanDescription]
        );

        return res.status(201).json({
            status: "GOOD",
            message: "Category added successfully",
            category: result.rows[0]
        });

    } catch (error) {
        console.error(error);

        if (error.code === "23505") {
            return res.status(409).json({
                status: "ERROR",
                message: "Category name already exists"
            });
        }

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};