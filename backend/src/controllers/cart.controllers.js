import { pool } from "../config/database.js";

export const createCart = async (req, res) => {
    try {
        const existingCartResult = await pool.query(
            `
            SELECT
                id,
                user_id,
                created_at,
                expires_at
            FROM cart
            WHERE user_id = $1;
            `,
            [req.user.id]
        );

        if (existingCartResult.rows.length === 0) {
            const newCartResult = await pool.query(
                `
                INSERT INTO cart (user_id)
                VALUES ($1)
                RETURNING
                    id,
                    user_id,
                    created_at,
                    expires_at;
                `,
                [req.user.id]
            );

            return res.status(201).json({
                status: "GOOD",
                message: "Cart created successfully",
                cart: newCartResult.rows[0]
            });
        }

        const existingCart = existingCartResult.rows[0];

        const now = new Date();

        if (new Date(existingCart.expires_at) > now) {
            return res.status(200).json({
                status: "GOOD",
                message: "Active cart already exists",
                cart: existingCart
            });
        }

        await pool.query(
            `
            DELETE FROM cart
            WHERE id = $1;
            `,
            [existingCart.id]
        );

        const newCartResult = await pool.query(
            `
            INSERT INTO cart (user_id)
            VALUES ($1)
            RETURNING
                id,
                user_id,
                created_at,
                expires_at;
            `,
            [req.user.id]
        );

        return res.status(201).json({
            status: "GOOD",
            message: "Expired cart replaced successfully",
            cart: newCartResult.rows[0]
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};