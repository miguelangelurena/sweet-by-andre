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

export const updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;

        const updates = [];
        const values = [];

        if (name !== undefined) {
            if (typeof name !== "string" || name.trim() === "") {
                return res.status(400).json({
                    status: "ERROR",
                    message: "name must be a non-empty string"
                });
            }

            updates.push(`name = $${values.length + 1}`);
            values.push(name.trim());
        }

        if (description !== undefined) {
            if (description !== null && typeof description !== "string") {
                return res.status(400).json({
                    status: "ERROR",
                    message: "description must be a string or null"
                });
            }
            updates.push(`description = $${values.length + 1}`);
            values.push(description === null ? null : description.trim());
        }

        if (updates.length === 0) {
            return res.status(400).json({
                status: "ERROR",
                message: "No fields provided for update"
            });
        }

        const result = await pool.query(
            `
            UPDATE categories
            SET ${updates.join(", ")},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $${values.length + 1}
            RETURNING
                id,
                name,
                description,
                is_active,
                updated_at;
            `,
            [...values, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Category not found"
            });
        }

        return res.status(200).json({
            status: "GOOD",
            message: "Category updated successfully",
            category: result.rows[0]
        });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                status: "ERROR",
                message: "Category name already exists"
            });
        }

        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};

export const updateCategoryStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;

        if (typeof is_active !== "boolean") {
            return res.status(400).json({
                status: "ERROR",
                message: "is_active must be a boolean"
            });
        }

        const result = await pool.query(
            `
            UPDATE categories
            SET is_active = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, name, is_active, updated_at;
            `,
            [is_active, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Category not found"
            });
        }

        return res.status(200).json({
            status: "GOOD",
            message: "Category status updated successfully",
            category: result.rows[0]
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};