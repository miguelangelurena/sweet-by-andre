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
                c.name AS category_name
            FROM products p
            INNER JOIN categories c
                ON p.category_id = c.id
            WHERE p.id = $1
              AND p.is_available = TRUE
              AND c.is_active = TRUE
            `,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product not found"
            });
        }

        return res.status(200).json({
            status: "GOOD",
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