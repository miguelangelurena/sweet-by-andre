import { pool } from "../config/database.js";

import {
    GUEST_CART_COOKIE,
    generateGuestToken,
    hashGuestToken,
    guestCartCookieOptions
} from "../utils/guestCart.js";

export const createGuestCart = async (req, res) => {
    try {
        const existingToken = req.cookies?.[GUEST_CART_COOKIE];

        // 1. Recuperar un carrito existente
        if (
            typeof existingToken === "string" &&
            /^[a-f0-9]{64}$/i.test(existingToken)
        ) {
            const tokenHash = hashGuestToken(existingToken);

            const existingCart = await pool.query(
                `
                SELECT id, created_at
                FROM cart
                WHERE guest_token_hash = $1;
                `,
                [tokenHash]
            );

            if (existingCart.rows.length > 0) {
                return res.status(200).json({
                    status: "GOOD",
                    message: "Guest cart retrieved successfully",
                    cart: existingCart.rows[0]
                });
            }
        }

        // 2. Crear un token criptográficamente seguro
        const guestToken = generateGuestToken();
        const guestTokenHash = hashGuestToken(guestToken);

        // 3. Crear el carrito en PostgreSQL
        const result = await pool.query(
            `
            INSERT INTO cart (
                user_id,
                guest_token_hash
            )
            VALUES (NULL, $1)
            RETURNING id, created_at;
            `,
            [guestTokenHash]
        );

        // 4. Guardar el token original en una cookie
        res.cookie(
            GUEST_CART_COOKIE,
            guestToken,
            guestCartCookieOptions
        );

        return res.status(201).json({
            status: "GOOD",
            message: "Guest cart created successfully",
            cart: result.rows[0]
        });

    } catch (error) {
        console.error("Error creating guest cart:", error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};

export const getGuestCart = async (req, res) => {
    try {
        const cartResult = await pool.query(
            `
            SELECT id, created_at
            FROM cart
            WHERE id = $1
              AND user_id IS NULL;
            `,
            [req.cartId]
        );

        if (cartResult.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Guest cart not found"
            });
        }

        const cart = cartResult.rows[0];

        const itemsResult = await pool.query(
            `
            SELECT
                ci.id,
                ci.product_id,
                ci.variant_id,
                p.name AS product_name,
                ci.notes,
                ci.quantity,
                ci.price_at_added AS unit_price,
                v.price AS current_unit_price,
                ci.price_at_added <> v.price AS price_changed,
                ci.quantity * ci.price_at_added AS subtotal,
                ci.quantity * v.price AS current_subtotal,
                (
                    p.is_available = TRUE
                    AND c.is_active = TRUE
                    AND v.is_available = TRUE
                    AND v.stock >= ci.quantity
                ) AS is_available,
                v.stock AS variant_stock,
                COALESCE(
                    (
                        SELECT json_agg(
                            json_build_object(
                                'option_name', po.name,
                                'value', pov.value
                            )
                            ORDER BY po.display_order
                        )
                        FROM product_variant_values pvv
                        JOIN product_options po
                            ON po.id = pvv.option_id
                        JOIN product_option_values pov
                            ON pov.id = pvv.option_value_id
                        WHERE pvv.variant_id = v.id
                    ),
                    '[]'::json
                ) AS options
            FROM cart_items ci
            JOIN product_variants v
                ON v.id = ci.variant_id
            JOIN products p
                ON p.id = ci.product_id
            JOIN categories c
                ON c.id = p.category_id
            WHERE ci.cart_id = $1
            ORDER BY ci.created_at;
            `,
            [cart.id]
        );

        const items = itemsResult.rows;

        // PostgreSQL devuelve NUMERIC como string.
        // Calculamos los totales en centavos para evitar
        // errores habituales de coma flotante.
        const toCents = (amount) =>
            Math.round(Number(amount) * 100);

        const totalCents = items.reduce(
            (sum, item) => sum + toCents(item.unit_price) * item.quantity,
            0
        );

        const currentTotalCents = items.reduce(
            (sum, item) => sum + toCents(item.current_unit_price) * item.quantity,
            0
        );

        return res.status(200).json({
            status: "GOOD",
            message: "Guest cart retrieved successfully",
            cart: {
                id: cart.id,
                created_at: cart.created_at,
                items,
                total: (totalCents / 100).toFixed(2),
                current_total: (currentTotalCents / 100).toFixed(2),
                has_price_changes: items.some(
                    item => item.price_changed
                ),
                has_unavailable_items: items.some(
                    item => !item.is_available
                )
            }
        });

    } catch (error) {
        console.error("Error retrieving guest cart:", error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};