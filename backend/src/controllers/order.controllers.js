import { createHash } from "node:crypto";

import { pool } from "../config/database.js";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (res, status, message, code) =>
    res.status(status).json({
        status: "ERROR",
        ...(code ? { code } : {}),
        message
    });

const toCents = (value) => {
    const str = String(value);
    if (!/^\d+(\.\d{1,2})?$/.test(str)) {
        throw new Error("Invalid monetary value");
    }
    const [whole, decimal = ""] = str.split(".");
    const cents = Number(whole) * 100 +
        Number(decimal.padEnd(2, "0"));

    if (!Number.isSafeInteger(cents)) {
        throw new Error("Monetary value exceeds safe range");
    }
    return cents;
};

const toMoney = (cents) => (cents / 100).toFixed(2);

export const createOrder = async (req, res) => {
    const body = req.body ?? {};

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
        delivery_date,
        customer_email,
        customer_phone
    } = body;

    // The same logical checkout must reuse the same UUID, including after a timeout.
    const idempotencyKey = req.get("Idempotency-Key");
    if (typeof idempotencyKey !== "string" || !UUID_RE.test(idempotencyKey)) {
        return fail(res, 400, "A UUID Idempotency-Key header is required");
    }

    // Hash an explicitly ordered and normalized snapshot of the submitted form.
    // This prevents reusing the same key with changed delivery/contact details.
    const payloadSnapshot = [
        shipping_name, shipping_street, shipping_street_number,
        shipping_unit ?? "", shipping_city, shipping_state,
        shipping_zip_code, delivery_instructions ?? "", note ?? "",
        delivery_date, customer_email, customer_phone
    ].map(value => typeof value === "string" ? value.trim() : value);
    const payloadHash = createHash("sha256")
        .update(JSON.stringify(payloadSnapshot)).digest("hex");

    const userId = req.user?.id ?? null;
    const guestCartId = req.cartId ?? null;

    // An authenticated user or an authorized guest cart,
    // but never both.
    if (Boolean(userId) === Boolean(guestCartId)) {
        return fail(res, 401, "Cart ownership is not authorized");
    }

    const requiredFields = {
        shipping_name,
        shipping_street,
        shipping_street_number,
        shipping_city,
        shipping_state,
        shipping_zip_code,
        customer_email,
        customer_phone,
        delivery_date
    };

    for (const [field, value] of Object.entries(requiredFields)) {
        if (
            typeof value !== "string" ||
            !value.trim() ||
            value.length > 255
        ) {
            return fail(res, 400, `${field} is required or invalid`);
        }
    }

    for (const field of [
        "shipping_unit",
        "delivery_instructions",
        "note"
    ]) {
        if (
            body[field] != null &&
            (typeof body[field] !== "string" ||
                body[field].length > 2000)
        ) {
            return fail(res, 400, `${field} is invalid`);
        }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email.trim())) {
        return fail(res, 400, "Invalid customer_email");
    }

    // Require a timestamp with an explicit timezone.
    if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i
            .test(delivery_date)
    ) {
        return fail(
            res,
            400,
            "delivery_date must be an ISO timestamp with timezone"
        );
    }

    const parsedDate = new Date(delivery_date);

    if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.getTime() < Date.now() + 48 * 60 * 60 * 1000
    ) {
        return fail(
            res,
            400,
            "Delivery must be scheduled at least 48 hours in advance"
        );
    }

    let client;

    try {
        client = await pool.connect();
        await client.query("BEGIN");

        // Reserve the idempotency key before touching the cart or stock.
        // PostgreSQL's unique index serializes concurrent requests for the same key.
        const identityType = userId ? "user" : "guest";
        const identityId = userId ?? guestCartId;
        const reserved = await client.query(
            `INSERT INTO order_creation_requests
               (identity_type, identity_id, idempotency_key, payload_hash)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (identity_type, identity_id, idempotency_key)
             DO NOTHING
             RETURNING id`,
            [identityType, identityId, idempotencyKey, payloadHash]
        );

        if (!reserved.rowCount) {
            const existing = await client.query(
                `SELECT r.payload_hash, o.id, o.payment_status, o.order_status,
                        o.subtotal, o.shipping_cost, o.tax_amount, o.total
                 FROM order_creation_requests r
                 LEFT JOIN orders o ON o.id = r.order_id
                 WHERE r.identity_type = $1 AND r.identity_id = $2
                   AND r.idempotency_key = $3`,
                [identityType, identityId, idempotencyKey]
            );
            await client.query("ROLLBACK");
            if (!existing.rowCount) {
                return fail(res, 409, "Order request not available; please retry");
            }
            const previous = existing.rows[0];
            if (previous.payload_hash !== payloadHash) {
                return fail(res, 409, "Idempotency key was already used with different details");
            }
            if (!previous.id) {
                return fail(res, 409, "Order request is still being processed");
            }
            return res.status(200).json({
                status: "GOOD", message: "Existing pending order returned",
                reused: true,
                order: {
                    id: previous.id, payment_status: previous.payment_status,
                    order_status: previous.order_status, subtotal: previous.subtotal,
                    shipping_cost: previous.shipping_cost,
                    tax_amount: previous.tax_amount, total: previous.total
                }
            });
        }

        // Get only the cart authorized by middleware.
        const cartResult = userId
            ? await client.query(
                `SELECT id FROM cart
                 WHERE user_id = $1
                 FOR UPDATE`,
                [userId]
            )
            : await client.query(
                `SELECT id FROM cart
                 WHERE id = $1
                   AND user_id IS NULL
                   AND guest_token_hash IS NOT NULL
                 FOR UPDATE`,
                [guestCartId]
            );

        if (!cartResult.rowCount) {
            await client.query("ROLLBACK");
            return fail(res, 404, "Cart not found");
        }

        const cartId = cartResult.rows[0].id;

        const itemsResult = await client.query(
            `
            SELECT
                ci.id,
                ci.product_id,
                ci.variant_id,
                ci.quantity,
                ci.price_at_added,
                ci.notes
            FROM cart_items ci
            WHERE ci.cart_id = $1
            ORDER BY ci.id
            `,
            [cartId]
        );

        const items = itemsResult.rows;

        if (items.length === 0) {
            await client.query("ROLLBACK");
            return fail(res, 400, "Cannot order an empty cart");
        }

        const variantIds = [...new Set(
            items.map(item => item.variant_id)
        )].sort();

        const variants = new Map();

        // Lock variants consistently to reduce deadlock risk.
        for (const variantId of variantIds) {
            if (!UUID_RE.test(variantId ?? "")) {
                await client.query("ROLLBACK");
                return fail(res, 409, "Invalid cart variant");
            }

            const result = await client.query(
                `
                SELECT
                    v.id,
                    v.product_id,
                    v.price,
                    v.stock,
                    v.is_available,
                    p.name AS product_name,
                    p.is_available AS product_available,
                    c.is_active AS category_active,
                    COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'option_name', po.name,
                                'value', pov.value
                            )
                            ORDER BY po.display_order, po.name
                        )
                        FROM product_variant_values pvv
                        JOIN product_options po
                            ON po.id = pvv.option_id
                        JOIN product_option_values pov
                            ON pov.id = pvv.option_value_id
                           AND pov.option_id = po.id
                        WHERE pvv.variant_id = v.id
                    ), '[]'::jsonb) AS options_snapshot,
                    (
                        NOT EXISTS (
                            SELECT 1
                            FROM product_options po
                            WHERE po.product_id = v.product_id
                            AND (
                                SELECT COUNT(*)
                                FROM product_variant_values pvv
                                JOIN product_option_values pov
                                    ON pov.id = pvv.option_value_id
                                WHERE pvv.variant_id = v.id
                                  AND pvv.option_id = po.id
                                  AND pov.option_id = po.id
                                  AND pov.is_active = TRUE
                            ) <> 1
                        )
                        AND NOT EXISTS (
                            SELECT 1
                            FROM product_variant_values pvv
                            LEFT JOIN product_options po
                                ON po.id = pvv.option_id
                               AND po.product_id = v.product_id
                            LEFT JOIN product_option_values pov
                                ON pov.id = pvv.option_value_id
                            WHERE pvv.variant_id = v.id
                              AND (
                                  po.id IS NULL
                                  OR pov.id IS NULL
                                  OR pov.option_id <> pvv.option_id
                                  OR pov.is_active = FALSE
                              )
                        )
                    ) AS options_valid
                FROM product_variants v
                JOIN products p ON p.id = v.product_id
                JOIN categories c ON c.id = p.category_id
                WHERE v.id = $1
                FOR UPDATE OF v
                `,
                [variantId]
            );

            if (!result.rowCount) {
                await client.query("ROLLBACK");
                return fail(res, 409, "A cart variant no longer exists");
            }

            const variant = result.rows[0];

            if (
                !variant.is_available ||
                !variant.product_available ||
                !variant.category_active ||
                !variant.options_valid
            ) {
                await client.query("ROLLBACK");
                return fail(
                    res,
                    409,
                    `${variant.product_name} is unavailable`
                );
            }

            variants.set(variantId, variant);
        }

        const quantities = new Map();
        let subtotalCents = 0;

        for (const item of items) {
            const variant = variants.get(item.variant_id);

            if (
                variant.product_id !== item.product_id ||
                !Number.isSafeInteger(item.quantity) ||
                item.quantity <= 0
            ) {
                await client.query("ROLLBACK");
                return fail(res, 409, "Invalid cart item");
            }

            const quantity =
                (quantities.get(item.variant_id) ?? 0) +
                item.quantity;

            quantities.set(item.variant_id, quantity);

            if (quantity > variant.stock) {
                await client.query("ROLLBACK");
                return fail(
                    res,
                    409,
                    `Insufficient stock for ${variant.product_name}`
                );
            }

            if (toCents(item.price_at_added) !== toCents(variant.price)) {
                await client.query("ROLLBACK");
                return fail(
                    res,
                    409,
                    `Price changed for ${variant.product_name}`,
                    "PRICE_CHANGED"
                );
            }

            subtotalCents += toCents(variant.price) * item.quantity;

            if (!Number.isSafeInteger(subtotalCents)) {
                throw new Error("Order total exceeds safe range");
            }
        }

        // Temporary development values.
        // Shipping and taxes must be calculated before live payments.
        const shippingCents = 0;
        const taxCents = 0;
        const totalCents = subtotalCents + shippingCents + taxCents;

        const orderResult = await client.query(
            `
            INSERT INTO orders (
                user_id,
                guest_cart_id,
                customer_email,
                customer_phone,
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
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14,
                $15, $16, $17, $18, 'pending', 'pending'
            )
            RETURNING *;
            `,
            [
                userId,
                userId ? null : cartId,
                customer_email.trim().toLowerCase(),
                customer_phone.trim(),
                shipping_name.trim(),
                shipping_street.trim(),
                shipping_street_number.trim(),
                shipping_unit?.trim() || null,
                shipping_city.trim(),
                shipping_state.trim(),
                shipping_zip_code.trim(),
                delivery_instructions?.trim() || null,
                note?.trim() || null,
                parsedDate,
                toMoney(subtotalCents),
                toMoney(shippingCents),
                toMoney(taxCents),
                toMoney(totalCents)
            ]
        );

        const order = orderResult.rows[0];

        for (const item of items) {
            const variant = variants.get(item.variant_id);

            await client.query(
                `
                INSERT INTO order_items (
                    order_id,
                    product_id,
                    variant_id,
                    quantity,
                    unit_price,
                    notes,
                    options_snapshot,
                    product_name_snapshot
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `,
                [
                    order.id,
                    item.product_id,
                    item.variant_id,
                    item.quantity,
                    variant.price,
                    item.notes,
                    JSON.stringify(variant.options_snapshot),
                    variant.product_name
                ]
            );
        }

        // Publish the created order in the same transaction as its line items.
        await client.query(
            `UPDATE order_creation_requests SET order_id = $1 WHERE id = $2`,
            [order.id, reserved.rows[0].id]
        );

        // The cart remains intact until we implement
        // the payment finalization strategy.
        await client.query("COMMIT");

        return res.status(201).json({
            status: "GOOD",
            message: "Pending order created successfully",
            order: {
                id: order.id,
                payment_status: order.payment_status,
                order_status: order.order_status,
                subtotal: order.subtotal,
                shipping_cost: order.shipping_cost,
                tax_amount: order.tax_amount,
                total: order.total
            }
        });

    } catch (error) {
        if (client) {
            await client.query("ROLLBACK").catch(console.error);
        }

        console.error("Create order error:", error);

        return fail(res, 500, "Internal server error");

    } finally {
        client?.release();
    }
};
