
import { pool } from "../config/database.js";

export const getProductVariants = async (req, res) => {
    const { id: productId } = req.params;

    try {
        const productResult = await pool.query(
            `
            SELECT id, name, inventory_mode
            FROM products
            WHERE id = $1
            `,
            [productId]
        );

        if (productResult.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product not found"
            });
        }

        const variantsResult = await pool.query(
            `
            SELECT
                pv.id,
                pv.product_id,
                pv.price,
                pv.stock,
                pv.production_points,
                pv.is_available,
                pv.created_at,
                COALESCE(
                    (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'option_id', po.id,
                                'option_name', po.name,
                                'value_id', pov.id,
                                'value', pov.value
                            )
                            ORDER BY po.display_order, po.name
                        )
                        FROM product_variant_values pvv
                        INNER JOIN product_options po
                            ON po.id = pvv.option_id
                        INNER JOIN product_option_values pov
                            ON pov.id = pvv.option_value_id
                        WHERE pvv.variant_id = pv.id
                    ),
                    '[]'::jsonb
                ) AS options
            FROM product_variants pv
            WHERE pv.product_id = $1
            ORDER BY pv.created_at, pv.id
            `,
            [productId]
        );

        const isAdminRequest = req.path.startsWith("/admin/");

        // Get configured options and their values
        const optionsResult = await pool.query(
            `
    SELECT
        po.id AS option_id,
        pov.id AS value_id,
        pov.is_active
    FROM product_options po
    LEFT JOIN product_option_values pov
        ON pov.option_id = po.id
    WHERE po.product_id = $1
    `,
            [productId]
        );

        let visibleVariants = variantsResult.rows;

        if (!isAdminRequest) {
            const requiredOptionIds = new Set(
                optionsResult.rows.map((row) => row.option_id)
            );

            const activeValues = new Set(
                optionsResult.rows
                    .filter((row) => row.is_active === true)
                    .map((row) => `${row.option_id}:${row.value_id}`)
            );

            visibleVariants = variantsResult.rows.filter((variant) => {
                // Variant must be available and have stock
                if (!variant.is_available || (productResult.rows[0].inventory_mode === "stock" && variant.stock <= 0)) {
                    return false;
                }

                // Must select exactly one value per configured option
                if (variant.options.length !== requiredOptionIds.size) {
                    return false;
                }

                const selectedOptionIds = new Set(
                    variant.options.map((option) => option.option_id)
                );

                // Reject repeated or unexpected options
                if (selectedOptionIds.size !== requiredOptionIds.size) {
                    return false;
                }

                // Every selected value must be active
                return variant.options.every((option) => {
                    return (
                        requiredOptionIds.has(option.option_id) &&
                        activeValues.has(
                            `${option.option_id}:${option.value_id}`
                        )
                    );
                });
            });
        }

        return res.status(200).json({
            status: "GOOD",
            product: productResult.rows[0],
            variants: visibleVariants
        });

    } catch (error) {
        console.error("Get product variants error:", error);

        if (error.code === "22P02") {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid product ID"
            });
        }

        return res.status(500).json({
            status: "ERROR",
            message: "Could not retrieve product variants"
        });
    }
};


export const createProductOption = async (req, res) => {
    const { id: productId } = req.params;
    const { name } = req.body;

    if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
            status: "ERROR",
            message: "Option name is required"
        });
    }

    try {
        const result = await pool.query(
            `
            INSERT INTO product_options (
                product_id,
                name
            )
            SELECT
                p.id,
                $2
            FROM products p
            WHERE p.id = $1
            RETURNING
                id,
                product_id,
                name,
                display_order,
                created_at
            `,
            [productId, name.trim()]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product not found"
            });
        }

        return res.status(201).json({
            status: "GOOD",
            message: "Product option created successfully",
            option: result.rows[0]
        });

    } catch (error) {
        console.error("Create product option error:", error);

        if (error.code === "23505") {
            return res.status(409).json({
                status: "ERROR",
                message: "This option already exists for this product"
            });
        }

        if (error.code === "22P02") {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid product ID"
            });
        }

        return res.status(500).json({
            status: "ERROR",
            message: "Could not create product option"
        });
    }
};


export const createProductOptionValue = async (req, res) => {
    const { optionId } = req.params;
    const { value } = req.body;

    if (typeof value !== "string" || !value.trim()) {
        return res.status(400).json({
            status: "ERROR",
            message: "Option value is required"
        });
    }

    try {
        const result = await pool.query(
            `
            INSERT INTO product_option_values (
                option_id,
                value
            )
            SELECT
                po.id,
                $2
            FROM product_options po
            WHERE po.id = $1
            RETURNING
                id,
                option_id,
                value,
                display_order,
                is_active
            `,
            [optionId, value.trim()]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product option not found"
            });
        }

        return res.status(201).json({
            status: "GOOD",
            message: "Option value created successfully",
            option_value: result.rows[0]
        });

    } catch (error) {
        console.error("Create option value error:", error);

        if (error.code === "23505") {
            return res.status(409).json({
                status: "ERROR",
                message: "This value already exists for this option"
            });
        }

        if (error.code === "22P02") {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid option ID"
            });
        }

        return res.status(500).json({
            status: "ERROR",
            message: "Could not create option value"
        });
    }
};


export const createProductVariant = async (req, res) => {
    const { id: productId } = req.params;
    const { price, stock, is_available = true, options } = req.body;

    if (
        typeof price !== "number" ||
        !Number.isFinite(price) ||
        price <= 0
    ) {
        return res.status(400).json({
            status: "ERROR",
            message: "price must be greater than zero"
        });
    }

    if (!Number.isInteger(stock) || stock < 0) {
        return res.status(400).json({
            status: "ERROR",
            message: "stock must be a non-negative integer"
        });
    }

    if (typeof is_available !== "boolean") {
        return res.status(400).json({
            status: "ERROR",
            message: "is_available must be a boolean"
        });
    }

    if (
        !Array.isArray(options) ||
        options.length === 0 ||
        options.some(
            (option) =>
                !option ||
                typeof option.option_id !== "string" ||
                typeof option.value_id !== "string"
        )
    ) {
        return res.status(400).json({
            status: "ERROR",
            message: "At least one valid option is required"
        });
    }

    const optionIds = options.map((option) => option.option_id);

    if (new Set(optionIds).size !== optionIds.length) {
        return res.status(400).json({
            status: "ERROR",
            message: "An option cannot be selected twice"
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Lock product to serialize variant creation.
        const productResult = await client.query(
            "SELECT id FROM products WHERE id = $1 FOR UPDATE",
            [productId]
        );

        if (productResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                status: "ERROR",
                message: "Product not found"
            });
        }

        // Ensure the selected values belong to this product.
        const selectedValues = await client.query(
            `
            SELECT po.id AS option_id, pov.id AS value_id
            FROM product_options po
            INNER JOIN product_option_values pov
                ON pov.option_id = po.id
            WHERE po.product_id = $1
              AND pov.is_active = TRUE
            `,
            [productId]
        );

        const validPairs = new Set(
            selectedValues.rows.map(
                (row) => `${row.option_id}:${row.value_id}`
            )
        );

        if (
            options.some(
                (option) =>
                    !validPairs.has(
                        `${option.option_id}:${option.value_id}`
                    )
            )
        ) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid option values for this product"
            });
        }

        // Require one value for every configured option.
        const configuredOptions = await client.query(
            `
            SELECT COUNT(*)::integer AS count
            FROM product_options
            WHERE product_id = $1
            `,
            [productId]
        );

        if (options.length !== configuredOptions.rows[0].count) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                status: "ERROR",
                message: "Select one value for every product option"
            });
        }

        // Reject an existing identical combination.
        const existingVariants = await client.query(
            `
            SELECT
                pv.id,
                ARRAY_AGG(pvv.option_value_id)
                    FILTER (WHERE pvv.option_value_id IS NOT NULL)
                    AS value_ids
            FROM product_variants pv
            LEFT JOIN product_variant_values pvv
                ON pvv.variant_id = pv.id
            WHERE pv.product_id = $1
            GROUP BY pv.id
            `,
            [productId]
        );

        const requested = options
            .map((option) => option.value_id)
            .sort()
            .join(",");

        const duplicate = existingVariants.rows.some((variant) => {
            const existing = (variant.value_ids ?? [])
                .sort()
                .join(",");

            return existing === requested;
        });

        if (duplicate) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                status: "ERROR",
                message: "This product variant already exists"
            });
        }

        const variantResult = await client.query(
            `
            INSERT INTO product_variants (
                product_id,
                price,
                stock,
                is_available
            )
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `,
            [productId, price, stock, is_available]
        );

        const variant = variantResult.rows[0];

        for (const option of options) {
            await client.query(
                `
                INSERT INTO product_variant_values (
                    variant_id,
                    option_id,
                    option_value_id
                )
                VALUES ($1, $2, $3)
                `,
                [variant.id, option.option_id, option.value_id]
            );
        }

        await client.query("COMMIT");

        return res.status(201).json({
            status: "GOOD",
            message: "Product variant created successfully",
            variant
        });

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Create product variant error:", error);

        if (error.code === "22P02") {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid UUID"
            });
        }

        return res.status(500).json({
            status: "ERROR",
            message: "Could not create product variant"
        });
    } finally {
        client.release();
    }
};

export const updateProductVariant = async (req, res) => {
    const { id } = req.params;

    const {
        price,
        stock,
        is_available
    } = req.body;

    const updates = [];
    const values = [];

    // -------------------------
    // PRICE
    // -------------------------

    if (price !== undefined) {
        if (
            typeof price !== "number" ||
            !Number.isFinite(price) ||
            price <= 0
        ) {
            return res.status(400).json({
                status: "ERROR",
                message: "price must be greater than zero"
            });
        }

        updates.push(`price = $${values.length + 1}`);
        values.push(price);
    }

    // -------------------------
    // STOCK
    // -------------------------

    if (stock !== undefined) {
        if (
            !Number.isInteger(stock) ||
            stock < 0
        ) {
            return res.status(400).json({
                status: "ERROR",
                message: "stock must be a non-negative integer"
            });
        }

        updates.push(`stock = $${values.length + 1}`);
        values.push(stock);
    }

    // -------------------------
    // AVAILABILITY
    // -------------------------

    if (is_available !== undefined) {
        if (typeof is_available !== "boolean") {
            return res.status(400).json({
                status: "ERROR",
                message: "is_available must be a boolean"
            });
        }

        updates.push(`is_available = $${values.length + 1}`);
        values.push(is_available);
    }

    // -------------------------
    // NO FIELDS
    // -------------------------

    if (updates.length === 0) {
        return res.status(400).json({
            status: "ERROR",
            message: "No fields provided for update"
        });
    }

    try {
        values.push(id);

        const result = await pool.query(
            `
            UPDATE product_variants
            SET
                ${updates.join(", ")},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $${values.length}
            RETURNING
                id,
                product_id,
                price,
                stock,
                is_available,
                updated_at
            `,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product variant not found"
            });
        }

        return res.status(200).json({
            status: "GOOD",
            message: "Product variant updated successfully",
            variant: result.rows[0]
        });

    } catch (error) {
        console.error("Update product variant error:", error);

        if (error.code === "22P02") {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid variant ID"
            });
        }

        return res.status(500).json({
            status: "ERROR",
            message: "Could not update product variant"
        });
    }
};

export const getProductOptions = async (req, res) => {
    const { id: productId } = req.params;

    try {
        // -------------------------
        // CHECK PRODUCT
        // -------------------------

        const productResult = await pool.query(
            `
            SELECT id, name
            FROM products
            WHERE id = $1
            `,
            [productId]
        );

        if (productResult.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product not found"
            });
        }

        // -------------------------
        // GET OPTIONS AND VALUES
        // -------------------------

        const result = await pool.query(
            `
            SELECT
                po.id,
                po.product_id,
                po.name,
                po.display_order,
                COALESCE(
                    (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'id', pov.id,
                                'value', pov.value,
                                'display_order', pov.display_order,
                                'is_active', pov.is_active
                            )
                            ORDER BY
                                pov.display_order,
                                pov.value
                        )
                        FROM product_option_values pov
                        WHERE pov.option_id = po.id
                    ),
                    '[]'::jsonb
                ) AS values
            FROM product_options po
            WHERE po.product_id = $1
            ORDER BY po.display_order, po.name
            `,
            [productId]
        );

        return res.status(200).json({
            status: "GOOD",
            product: productResult.rows[0],
            options: result.rows
        });

    } catch (error) {
        console.error("Get product options error:", error);

        if (error.code === "22P02") {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid product ID"
            });
        }

        return res.status(500).json({
            status: "ERROR",
            message: "Could not retrieve product options"
        });
    }
};

export const updateProductOption = async (req, res) => {
    const { optionId } = req.params;
    const { name, display_order } = req.body;

    const updates = [];
    const values = [];

    // -------------------------
    // NAME
    // -------------------------

    if (name !== undefined) {
        if (typeof name !== "string" || !name.trim()) {
            return res.status(400).json({
                status: "ERROR",
                message: "Option name must be a non-empty string"
            });
        }

        updates.push(`name = $${values.length + 1}`);
        values.push(name.trim());
    }

    // -------------------------
    // DISPLAY ORDER
    // -------------------------

    if (display_order !== undefined) {
        if (
            !Number.isInteger(display_order) ||
            display_order < 0
        ) {
            return res.status(400).json({
                status: "ERROR",
                message: "display_order must be a non-negative integer"
            });
        }

        updates.push(`display_order = $${values.length + 1}`);
        values.push(display_order);
    }

    if (updates.length === 0) {
        return res.status(400).json({
            status: "ERROR",
            message: "No valid fields provided for update"
        });
    }

    try {
        values.push(optionId);

        const result = await pool.query(
            `
            UPDATE product_options
            SET
                ${updates.join(", ")},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $${values.length}
            RETURNING
                id,
                product_id,
                name,
                display_order,
                updated_at
            `,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product option not found"
            });
        }

        return res.status(200).json({
            status: "GOOD",
            message: "Product option updated successfully",
            option: result.rows[0]
        });

    } catch (error) {
        console.error("Update product option error:", error);

        if (error.code === "23505") {
            return res.status(409).json({
                status: "ERROR",
                message: "An option with this name already exists"
            });
        }

        if (error.code === "22P02") {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid option ID"
            });
        }

        return res.status(500).json({
            status: "ERROR",
            message: "Could not update product option"
        });
    }
};

export const updateProductOptionValue = async (req, res) => {
    const { valueId } = req.params;

    const {
        value,
        display_order,
        is_active
    } = req.body;

    const updates = [];
    const values = [];

    // -------------------------
    // VALUE
    // -------------------------

    if (value !== undefined) {
        if (
            typeof value !== "string" ||
            !value.trim()
        ) {
            return res.status(400).json({
                status: "ERROR",
                message: "Value must be a non-empty string"
            });
        }

        updates.push(`value = $${values.length + 1}`);
        values.push(value.trim());
    }

    // -------------------------
    // DISPLAY ORDER
    // -------------------------

    if (display_order !== undefined) {
        if (
            !Number.isInteger(display_order) ||
            display_order < 0
        ) {
            return res.status(400).json({
                status: "ERROR",
                message: "display_order must be a non-negative integer"
            });
        }

        updates.push(`display_order = $${values.length + 1}`);
        values.push(display_order);
    }

    // -------------------------
    // ACTIVE STATUS
    // -------------------------

    if (is_active !== undefined) {
        if (typeof is_active !== "boolean") {
            return res.status(400).json({
                status: "ERROR",
                message: "is_active must be a boolean"
            });
        }

        updates.push(`is_active = $${values.length + 1}`);
        values.push(is_active);
    }

    // -------------------------
    // NO FIELDS
    // -------------------------

    if (updates.length === 0) {
        return res.status(400).json({
            status: "ERROR",
            message: "No fields provided for update"
        });
    }

    try {
        values.push(valueId);

        const result = await pool.query(
            `
            UPDATE product_option_values
            SET ${updates.join(", ")}
            WHERE id = $${values.length}
            RETURNING
                id,
                option_id,
                value,
                display_order,
                is_active
            `,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product option value not found"
            });
        }

        return res.status(200).json({
            status: "GOOD",
            message: "Product option value updated successfully",
            option_value: result.rows[0]
        });

    } catch (error) {
        console.error("Update product option value error:", error);

        if (error.code === "23505") {
            return res.status(409).json({
                status: "ERROR",
                message: "This value already exists for the option"
            });
        }

        if (error.code === "22P02") {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid option value ID"
            });
        }

        return res.status(500).json({
            status: "ERROR",
            message: "Could not update product option value"
        });
    }
};
