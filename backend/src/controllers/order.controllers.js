import { pool } from "../config/database.js";

export const createOrder = async (req, res) => {
    const userId = req.user.id;

    const {
        shipping_name,
        shipping_street,
        shipping_street_number,
        shipping_unit,
        shipping_city,
        shipping_state,
        shipping_zip_code,
        delivery_instructions,
        note,
        delivery_date
    } = req.body;

    const requiredFields = {
        shipping_name,
        shipping_street,
        shipping_street_number,
        shipping_city,
        shipping_state,
        shipping_zip_code,
        delivery_date
    };

    for (const [field, value] of Object.entries(requiredFields)) {
        if (typeof value !== "string" || value.trim() === "") {
            return res.status(400).json({
                status: "ERROR",
                message: `${field} is required`
            });
        }
    }

    const parsedDeliveryDate = new Date(delivery_date);

    if (Number.isNaN(parsedDeliveryDate.getTime())) {
        return res.status(400).json({
            status: "ERROR",
            message: "Invalid delivery_date"
        });
    }

    const minimumDeliveryDate = new Date(Date.now() + 48 * 60 * 60 * 1000);

    if (parsedDeliveryDate < minimumDeliveryDate) {
        return res.status(400).json({
            status: "ERROR",
            message: "Delivery must be scheduled at least 48 hours in advance"
        });
    }

    let client;

    try {
        client = await pool.connect();
        await client.query("BEGIN");

        const cartResult = await client.query(
            `
            SELECT id
            FROM cart
            WHERE user_id = $1
            FOR UPDATE;
`,
            [userId]
        );

        if (cartResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                status: "ERROR",
                message: "Cart not found"
            });
        }

        const cartId = cartResult.rows[0].id;

        const itemsResult = await client.query(
            `
    SELECT
        ci.product_id,
        ci.quantity,
        ci.price_at_added,
        p.name,
        p.price,
        p.stock,
        p.is_available
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    WHERE ci.cart_id = $1
    FOR UPDATE OF p;
    `,
            [cartId]
        );

        const items = itemsResult.rows;

        const priceChanges = items
            .filter(item =>
                Math.round(Number(item.price_at_added) * 100) !==
                Math.round(Number(item.price) * 100)
            )
            .map(item => ({
                product_id: item.product_id,
                product_name: item.name,
                quantity: item.quantity,
                previous_price: Number(item.price_at_added).toFixed(2),
                current_price: Number(item.price).toFixed(2)
            }));

        if (priceChanges.length > 0) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                status: "ERROR",
                code: "PRICE_CHANGED",
                message: "Some product prices have changed. Please review your cart before placing the order.",
                price_changes: priceChanges
            });
        }

        if (items.length === 0) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                status: "ERROR",
                message: "Cannot create an order with an empty cart"
            });
        }

        for (const item of items) {
            if (!item.is_available) {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    status: "ERROR",
                    message: `${item.name} is not available`
                });
            }

        }

        const subtotalInCents = items.reduce(
            (sum, item) => {
                const priceInCents = Math.round(Number(item.price) * 100);
                return sum + priceInCents * item.quantity;
            },
            0
        );

        const shippingCostInCents = 0;
        const taxAmountInCents = 0;

        const totalInCents =
            subtotalInCents + shippingCostInCents + taxAmountInCents;

        const subtotal = subtotalInCents / 100;
        const shippingCost = shippingCostInCents / 100;
        const taxAmount = taxAmountInCents / 100;
        const total = totalInCents / 100;

        const orderResult = await client.query(
            `
            INSERT INTO orders(
    user_id,
    shipping_name,
    shipping_street,
    shipping_street_number,
    shipping_unit,
    shipping_city,
    shipping_state,
    shipping_zip_code,
    delivery_instructions,
    note,
    delivery_date,
    subtotal,
    shipping_cost,
    tax_amount,
    total,
    payment_status,
    order_status
)
VALUES(
    $1, $2, $3, $4, $5, $6, $7, $8, $9,
    $10, $11, $12, $13, $14, $15, 'pending', 'pending'
)
RETURNING *;
`,
            [
                userId,
                shipping_name.trim(),
                shipping_street.trim(),
                shipping_street_number.trim(),
                shipping_unit?.trim() || null,
                shipping_city.trim(),
                shipping_state.trim(),
                shipping_zip_code.trim(),
                delivery_instructions?.trim() || null,
                note?.trim() || null,
                parsedDeliveryDate,
                subtotal,
                shippingCost,
                taxAmount,
                total
            ]
        );

        const order = orderResult.rows[0];

        for (const item of items) {
            await client.query(
                `
                INSERT INTO order_items(
    order_id,
    product_id,
    quantity,
    unit_price
)
VALUES($1, $2, $3, $4);
`,
                [
                    order.id,
                    item.product_id,
                    item.quantity,
                    item.price
                ]
            );
        }

        await client.query(
            "DELETE FROM cart_items WHERE cart_id = $1;",
            [cartId]
        );

        await client.query("COMMIT");

        return res.status(201).json({
            status: "GOOD",
            message: "Order created successfully. Payment is pending.",
            order
        });

    } catch (error) {
        if (client) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Rollback failed:", rollbackError);
            }
        }

        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    } finally {
        client?.release();
    }
};