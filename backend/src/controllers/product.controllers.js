import { pool } from "../config/database.js";

export const getProducts = async (req, res) => {
    try {

        const result = await pool.query(`
       SELECT p.id,
       p.NAME,
       p.description,
       p.price,
       p.stock,
       p.is_available,
       c.id   AS category_id,
       c.NAME AS category_name
       FROM   products p
       INNER JOIN categories c
       ON p.category_id = c.id
       WHERE  p.is_available = true
       AND c.is_active = true
       ORDER  BY p.NAME; 
        `
        );

        return res.status(200).json({
            status: "GOOD",
            products: result.rows
        });


    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};

export const getProductById = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `
    SELECT
    p.id,
    p.name,
    p.description,
    p.price,
    p.stock,
    p.is_available,
    c.id AS category_id,
    c.name AS category_name,
    pi.id AS image_id,
    pi.image_url,
    pi.display_order
    FROM products p
    INNER JOIN categories c
    ON p.category_id = c.id
    LEFT JOIN product_images pi
    ON p.id = pi.product_id
    WHERE p.id = $1
    AND p.is_available = TRUE
    AND c.is_active = TRUE
    ORDER BY pi.display_order;
            `,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product not found"
            });
        }

        const product = {
            id: result.rows[0].id,
            name: result.rows[0].name,
            description: result.rows[0].description,
            price: result.rows[0].price,
            stock: result.rows[0].stock,
            is_available: result.rows[0].is_available,
            category_id: result.rows[0].category_id,
            category_name: result.rows[0].category_name,
            images: []
        };

        for (const row of result.rows) {
            if (row.image_id) {
                product.images.push({
                    id: row.image_id,
                    image_url: row.image_url,
                    display_order: row.display_order
                });
            }
        }

        return res.status(200).json({
            status: "GOOD",
            product: product
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};

export const updateProductAvailability = async (req, res) => {
    try {
        const { id } = req.params;
        const { is_available } = req.body;

        if (typeof is_available !== "boolean") {
            return res.status(400).json({
                status: "ERROR",
                message: "is_available must be a boolean"
            });
        }

        const result = await pool.query(
            `
            UPDATE products
            SET is_available = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, name, is_available, updated_at;
            `,
            [is_available, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product not found"
            });
        }

        return res.status(200).json({
            status: "GOOD",
            message: "Product availability updated",
            product: result.rows[0]
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};