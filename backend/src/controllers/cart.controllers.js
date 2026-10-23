import { pool } from "../config/database.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validUuid = (value) => typeof value === "string" && UUID_RE.test(value);
const validQuantity = (value) => Number.isSafeInteger(value) && value > 0;
const rollback = async (client) => {
    try { await client.query("ROLLBACK"); }
    catch (error) { console.error("Rollback failed:", error); }
};
const serverError = (res, error) => {
    console.error(error);
    return res.status(500).json({ status: "ERROR", message: "Internal server error" });
};
const fail = (res, code, message) => res.status(code).json({ status: "ERROR", message });

// A variant is purchasable only when every product option has exactly one
// selected active value belonging to that option, and no extra selections.
const VARIANT_VALIDITY = `
    NOT EXISTS (
        SELECT 1 FROM product_options po
        WHERE po.product_id = v.product_id
          AND (SELECT COUNT(*) FROM product_variant_values pvv
               JOIN product_option_values pov ON pov.id = pvv.option_value_id
               WHERE pvv.variant_id = v.id
                 AND pvv.option_id = po.id
                 AND pov.option_id = po.id
                 AND pov.is_active = TRUE) <> 1
    )
    AND NOT EXISTS (
        SELECT 1 FROM product_variant_values pvv
        LEFT JOIN product_options po ON po.id = pvv.option_id AND po.product_id = v.product_id
        LEFT JOIN product_option_values pov ON pov.id = pvv.option_value_id
        WHERE pvv.variant_id = v.id
          AND (po.id IS NULL OR pov.id IS NULL OR pov.option_id <> pvv.option_id OR pov.is_active = FALSE)
    )
`;

const loadVariant = (client, variantId) => client.query(`
    SELECT v.id, v.product_id, v.price, v.stock,
           (v.is_available AND p.is_available AND c.is_active
            AND (${VARIANT_VALIDITY})) AS purchasable
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    JOIN categories c ON c.id = p.category_id
    WHERE v.id = $1
    FOR UPDATE OF v;
`, [variantId]);

export const createCart = async (req, res) => {
    try {
        const result = await pool.query(`
            INSERT INTO cart (user_id) VALUES ($1)
            ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
            RETURNING id, user_id, created_at;
        `, [req.user.id]);
        return res.status(200).json({ status: "GOOD", message: "Cart ready", cart: result.rows[0] });
    } catch (error) { return serverError(res, error); }
};

export const addCartItem = async (req, res) => {
    const { variant_id, quantity, notes } = req.body ?? {};
    if (!validUuid(variant_id)) return fail(res, 400, "A valid variant_id is required");
    if (!validQuantity(quantity)) return fail(res, 400, "Quantity must be a positive integer");
    if (notes != null && typeof notes !== "string") return fail(res, 400, "Notes must be a string");
    const normalizedNotes = notes?.trim() || null;
    if (normalizedNotes && normalizedNotes.length > 500) return fail(res, 400, "Notes cannot exceed 500 characters");

    let client;
    try {
        client = await pool.connect();
        await client.query("BEGIN");
        const cartResult = await client.query("SELECT id FROM cart WHERE user_id = $1 FOR UPDATE", [req.user.id]);
        if (!cartResult.rowCount) { await rollback(client); return fail(res, 404, "Cart not found. Create your cart first."); }
        const cartId = cartResult.rows[0].id;
        const variantResult = await loadVariant(client, variant_id);
        if (!variantResult.rowCount) { await rollback(client); return fail(res, 404, "Variant not found"); }
        const variant = variantResult.rows[0];
        if (!variant.purchasable) { await rollback(client); return fail(res, 409, "This variant is not available or is not properly configured"); }

        // Count ALL lines for the variant, including lines with different notes.
        const quantityResult = await client.query(`
            SELECT COALESCE(SUM(quantity), 0)::integer AS quantity
            FROM cart_items WHERE cart_id = $1 AND variant_id = $2
        `, [cartId, variant_id]);
        if (Number(quantityResult.rows[0].quantity) + quantity > variant.stock) {
            await rollback(client);
            return fail(res, 409, `Only ${variant.stock} units are available for this variant`);
        }

        const itemResult = await client.query(`
            INSERT INTO cart_items (cart_id, product_id, variant_id, quantity, price_at_added, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (cart_id, variant_id, (COALESCE(notes, '')))
            DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
            RETURNING id, cart_id, product_id, variant_id, quantity, price_at_added, notes, created_at;
        `, [cartId, variant.product_id, variant.id, quantity, variant.price, normalizedNotes]);
        await client.query("COMMIT");
        return res.status(200).json({ status: "GOOD", message: "Item added to cart successfully", cart_item: itemResult.rows[0] });
    } catch (error) {
        if (client) await rollback(client);
        return serverError(res, error);
    } finally { client?.release(); }
};

export const getCart = async (req, res) => {
    try {
        const cartResult = await pool.query("SELECT id, created_at FROM cart WHERE user_id = $1", [req.user.id]);
        if (!cartResult.rowCount) return fail(res, 404, "Cart not found");
        const cart = cartResult.rows[0];
        const result = await pool.query(`
            SELECT ci.id, ci.product_id, ci.variant_id, p.name AS product_name,
                   ci.notes, ci.quantity, ci.price_at_added AS unit_price,
                   v.price AS current_unit_price,
                   (ci.price_at_added <> v.price) AS price_changed,
                   (ci.quantity * ci.price_at_added) AS subtotal,
                   (ci.quantity * v.price) AS current_subtotal,
                   (v.is_available AND p.is_available AND c.is_active AND v.stock >= ci.quantity
                    AND (${VARIANT_VALIDITY})) AS is_available,
                   v.stock AS variant_stock,
                   COALESCE((
                       SELECT json_agg(json_build_object('option_name', po.name, 'value', pov.value)
                                       ORDER BY po.display_order, po.name)
                       FROM product_variant_values pvv
                       JOIN product_options po ON po.id = pvv.option_id
                       JOIN product_option_values pov ON pov.id = pvv.option_value_id
                       WHERE pvv.variant_id = v.id
                   ), '[]'::json) AS options
            FROM cart_items ci
            JOIN product_variants v ON v.id = ci.variant_id
            JOIN products p ON p.id = v.product_id
            JOIN categories c ON c.id = p.category_id
            WHERE ci.cart_id = $1
            ORDER BY ci.created_at, ci.id;
        `, [cart.id]);
        const items = result.rows;
        // Numeric columns arrive as strings; totals use cents to avoid floating-point drift.
        const sumCents = (field) => items.reduce((sum, item) => sum + Math.round(Number(item[field]) * 100), 0);
        const money = (cents) => (cents / 100).toFixed(2);
        return res.status(200).json({
            status: "GOOD", message: "Cart retrieved successfully",
            cart: {
                id: cart.id, created_at: cart.created_at, items,
                total: money(sumCents("subtotal")),
                current_total: money(sumCents("current_subtotal")),
                has_price_changes: items.some((item) => item.price_changed),
                has_unavailable_items: items.some((item) => !item.is_available)
            }
        });
    } catch (error) { return serverError(res, error); }
};

export const updateCartItem = async (req, res) => {
    const { id } = req.params;
    const { quantity } = req.body ?? {};
    if (!validUuid(id)) return fail(res, 400, "Invalid cart item id");
    if (!validQuantity(quantity)) return fail(res, 400, "Quantity must be a positive integer");
    let client;
    try {
        client = await pool.connect();
        await client.query("BEGIN");
        const cartResult = await client.query("SELECT id FROM cart WHERE user_id = $1 FOR UPDATE", [req.user.id]);
        if (!cartResult.rowCount) { await rollback(client); return fail(res, 404, "Cart not found"); }
        const cartId = cartResult.rows[0].id;
        const itemResult = await client.query("SELECT id, variant_id FROM cart_items WHERE id = $1 AND cart_id = $2", [id, cartId]);
        if (!itemResult.rowCount) { await rollback(client); return fail(res, 404, "Cart item not found"); }
        const variantId = itemResult.rows[0].variant_id;
        const variantResult = await loadVariant(client, variantId);
        if (!variantResult.rowCount || !variantResult.rows[0].purchasable) {
            await rollback(client); return fail(res, 409, "This variant is no longer available");
        }
        const otherItemsResult = await client.query(`
            SELECT COALESCE(SUM(quantity), 0)::integer AS quantity
            FROM cart_items WHERE cart_id = $1 AND variant_id = $2 AND id <> $3
        `, [cartId, variantId, id]);
        if (Number(otherItemsResult.rows[0].quantity) + quantity > variantResult.rows[0].stock) {
            await rollback(client);
            return fail(res, 409, `Only ${variantResult.rows[0].stock} units are available for this variant`);
        }
        const updated = await client.query(`
            UPDATE cart_items SET quantity = $1 WHERE id = $2
            RETURNING id, cart_id, product_id, variant_id, quantity, price_at_added, notes;
        `, [quantity, id]);
        await client.query("COMMIT");
        return res.status(200).json({ status: "GOOD", message: "Cart item updated successfully", cart_item: updated.rows[0] });
    } catch (error) {
        if (client) await rollback(client);
        return serverError(res, error);
    } finally { client?.release(); }
};

export const deleteCartItem = async (req, res) => {
    const { id } = req.params;
    if (!validUuid(id)) return fail(res, 400, "Invalid cart item id");
    try {
        const result = await pool.query(`
            DELETE FROM cart_items ci USING cart c
            WHERE ci.id = $1 AND ci.cart_id = c.id AND c.user_id = $2
            RETURNING ci.id, ci.product_id, ci.variant_id;
        `, [id, req.user.id]);
        if (!result.rowCount) return fail(res, 404, "Cart item not found");
        return res.status(200).json({ status: "GOOD", message: "Cart item deleted successfully", cart_item: result.rows[0] });
    } catch (error) { return serverError(res, error); }
};

export const acceptCartPriceChanges = async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        await client.query("BEGIN");
        const cartResult = await client.query("SELECT id FROM cart WHERE user_id = $1 FOR UPDATE", [req.user.id]);
        if (!cartResult.rowCount) { await rollback(client); return fail(res, 404, "Cart not found"); }
        const cartId = cartResult.rows[0].id;
        const itemsResult = await client.query("SELECT id, variant_id, quantity FROM cart_items WHERE cart_id = $1 ORDER BY variant_id", [cartId]);
        // Lock variant rows in a stable order to reduce deadlock risk.
        const variantIds = [...new Set(itemsResult.rows.map((item) => item.variant_id))].sort();
        for (const variantId of variantIds) {
            const result = await loadVariant(client, variantId);
            if (!result.rowCount || !result.rows[0].purchasable) {
                await rollback(client); return fail(res, 409, "One or more cart variants are unavailable");
            }
            const totalQty = itemsResult.rows.filter((item) => item.variant_id === variantId)
                .reduce((sum, item) => sum + item.quantity, 0);
            if (totalQty > result.rows[0].stock) {
                await rollback(client); return fail(res, 409, "Insufficient stock for one or more cart variants");
            }
        }
        await client.query(`
            UPDATE cart_items ci SET price_at_added = v.price
            FROM product_variants v
            WHERE ci.cart_id = $1 AND ci.variant_id = v.id;
        `, [cartId]);
        await client.query("COMMIT");
        return res.status(200).json({ status: "GOOD", message: "Current cart prices accepted successfully" });
    } catch (error) {
        if (client) await rollback(client);
        return serverError(res, error);
    } finally { client?.release(); }
};