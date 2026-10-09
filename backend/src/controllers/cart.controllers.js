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
            activeCart: newCartResult.rows[0]
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};

export const addCartItem = async (req, res) => {
    const { product_id, quantity } = req.body;
    const userId = req.user.id;

    try {
        if (!Number.isInteger(quantity) || quantity <= 0) {
            return res.status(400).json({
                status: "ERROR",
                message: "Quantity must be an integer greater than zero"
            });
        }

        if (typeof product_id !== "string" || product_id.trim() === "") {
            return res.status(400).json({
                status: "ERROR",
                message: "product_id must be a valid string"
            });
        }

        const cartResult = await pool.query(
            `
            SELECT
                id,
                user_id,
                created_at,
                expires_at
            FROM cart
            WHERE user_id = $1;
            `,
            [userId]
        );

        if (cartResult.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Cart not found"
            });
        }

        const cart = cartResult.rows[0];
        let activeCart = cart;
        const now = new Date();

        if (new Date(cart.expires_at) <= now) {
            await pool.query(
                `
                DELETE FROM cart
                WHERE id = $1
                  AND user_id = $2;
                `,
                [cart.id, userId]
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
                [userId]
            );

            activeCart = newCartResult.rows[0];
        }

        const productResult = await pool.query(
            `
            SELECT
                id,
                name,
                price,
                stock,
                is_available
            FROM products
            WHERE id = $1;
            `,
            [product_id]
        );

        if (productResult.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product not found"
            });
        }

        const product = productResult.rows[0];

        if (!product.is_available) {
            return res.status(409).json({
                status: "ERROR",
                message: "Product not available"
            });
        }

        if (product.stock < quantity) {
            return res.status(409).json({
                status: "ERROR",
                message: "Insufficient stock"
            });
        }

        const existingCartItem = await pool.query(
            `
            SELECT
                id,
                quantity,
                price_at_added
            FROM cart_items
            WHERE cart_id = $1
              AND product_id = $2;
            `,
            [activeCart.id, product_id]
        );

        if (existingCartItem.rows.length > 0) {
            const cartItem = existingCartItem.rows[0];

            if (cartItem.quantity + quantity > product.stock) {
                return res.status(409).json({
                    status: "ERROR",
                    message: "Insufficient stock"
                });
            }

            const result = await pool.query(
                `
                UPDATE cart_items
                SET quantity = quantity + $1
                WHERE id = $2
                RETURNING
                    id,
                    cart_id,
                    product_id,
                    quantity,
                    price_at_added;
                `,
                [quantity, cartItem.id]
            );

            return res.status(200).json({
                status: "GOOD",
                message: "Cart item quantity updated successfully",
                cart_item: result.rows[0]
            });
        }

        const result = await pool.query(
            `
            INSERT INTO cart_items (
                cart_id,
                product_id,
                quantity,
                price_at_added
            )
            VALUES ($1, $2, $3, $4)
            RETURNING
                id,
                cart_id,
                product_id,
                quantity,
                price_at_added;
            `,
            [activeCart.id, product_id, quantity, product.price]
        );

        return res.status(201).json({
            status: "GOOD",
            message: "Cart created successfully",
            cart_item: result.rows[0]
        });

    } catch (error) {
        console.log(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};