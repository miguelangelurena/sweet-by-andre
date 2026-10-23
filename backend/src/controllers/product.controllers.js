import { pool } from "../config/database.js";
import { fileTypeFromBuffer } from "file-type";
import {
    uploadImageToCloudinary,
    deleteImageFromCloudinary
} from "../services/cloudinary.service.js";


export const getProducts = async (req, res) => {
    try {
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

                (
                    SELECT pi.image_url
                    FROM product_images pi
                    WHERE pi.product_id = p.id
                    ORDER BY pi.display_order ASC, pi.id ASC
                    LIMIT 1
                ) AS image_url,

                variant_summary.min_price,
                variant_summary.total_stock,
                (
                    variant_summary.min_price IS NOT NULL
                ) AS has_available_variants

            FROM products p

            INNER JOIN categories c
                ON p.category_id = c.id

            LEFT JOIN LATERAL (
                SELECT
                    MIN(v.price) AS min_price,
                    COALESCE(SUM(v.stock), 0) AS total_stock

                FROM product_variants v

                WHERE v.product_id = p.id
                  AND v.is_available = TRUE
                  AND v.stock > 0

                  AND (
                      SELECT COUNT(*)
                      FROM product_options po
                      WHERE po.product_id = p.id
                  ) = (
                      SELECT COUNT(DISTINCT pvv.option_id)
                      FROM product_variant_values pvv
                      INNER JOIN product_option_values pov
                          ON pov.id = pvv.option_value_id
                      WHERE pvv.variant_id = v.id
                        AND pov.is_active = TRUE
                  )

            ) AS variant_summary ON TRUE

            WHERE p.is_available = TRUE
              AND c.is_active = TRUE

            ORDER BY p.name;
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
            product
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
            RETURNING
                id,
                name,
                is_available,
                updated_at;
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


export const createProduct = async (req, res) => {
    try {
        const {
            name,
            description,
            price,
            stock,
            category_id
        } = req.body;

        // -------------------------
        // VALIDATIONS
        // -------------------------

        if (typeof name !== "string" || name.trim() === "") {
            return res.status(400).json({
                status: "ERROR",
                message: "name must be a non-empty string"
            });
        }

        if (
            description !== undefined &&
            typeof description !== "string"
        ) {
            return res.status(400).json({
                status: "ERROR",
                message: "description must be a string"
            });
        }

        if (
            typeof price !== "number" ||
            !Number.isFinite(price) ||
            price <= 0
        ) {
            return res.status(400).json({
                status: "ERROR",
                message: "price must be a number greater than 0"
            });
        }

        if (!Number.isInteger(stock) || stock < 0) {
            return res.status(400).json({
                status: "ERROR",
                message: "stock must be an integer greater than or equal to 0"
            });
        }

        if (
            typeof category_id !== "string" ||
            category_id.trim() === ""
        ) {
            return res.status(400).json({
                status: "ERROR",
                message: "category_id must be a valid string"
            });
        }

        // -------------------------
        // CHECK CATEGORY
        // -------------------------

        const categoryResult = await pool.query(
            `
            SELECT id
            FROM categories
            WHERE id = $1
              AND is_active = TRUE
            `,
            [category_id.trim()]
        );

        if (categoryResult.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Category not found or inactive"
            });
        }

        // -------------------------
        // CREATE PRODUCT
        // -------------------------

        const result = await pool.query(
            `
            INSERT INTO products (
                name,
                description,
                price,
                stock,
                category_id
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING
                id,
                name,
                description,
                price,
                stock,
                category_id,
                is_available,
                created_at;
            `,
            [
                name.trim(),
                description ?? null,
                price,
                stock,
                category_id.trim()
            ]
        );

        return res.status(201).json({
            status: "GOOD",
            message: "Product created successfully",
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

export const addProductImage = async (req, res) => {
    try {
        const { id } = req.params;
        const { image_url, display_order } = req.body;

        if (
            typeof image_url !== "string" ||
            image_url.trim() === ""
        ) {
            return res.status(400).json({
                status: "ERROR",
                message: "image_url must be a valid string"
            });
        }

        if (
            !Number.isInteger(display_order) ||
            display_order < 1
        ) {
            return res.status(400).json({
                status: "ERROR",
                message: "display_order must be an integer greater than zero"
            });
        }

        const existingProduct = await pool.query(
            `
            SELECT id
            FROM products
            WHERE id = $1;
            `,
            [id]
        );

        if (existingProduct.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product not found"
            });
        }

        const result = await pool.query(
            `
            INSERT INTO product_images (
                display_order,
                image_url,
                product_id
            )
            VALUES ($1, $2, $3)
            RETURNING
                id,
                image_url,
                display_order,
                product_id;
            `,
            [display_order, image_url.trim(), id]
        );

        return res.status(201).json({
            status: "GOOD",
            message: "Product image added successfully",
            product_image: result.rows[0]
        });

    } catch (error) {
        console.error(error);

        if (error.code === "23505") {
            return res.status(409).json({
                status: "ERROR",
                message: "Display order already exists for this product"
            });
        }

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};

export const getProductImages = async (req, res) => {
    try {
        const { id } = req.params;

        const existingProduct = await pool.query(
            `
            SELECT id
            FROM products
            WHERE id = $1;
            `,
            [id]
        );

        if (existingProduct.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product not found"
            });
        }

        const result = await pool.query(
            `
            SELECT
                id,
                image_url,
                display_order
            FROM product_images
            WHERE product_id = $1
            ORDER BY display_order;
            `,
            [id]
        );

        return res.status(200).json({
            status: "GOOD",
            images: result.rows
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};

export const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const {
            name,
            description,
            price,
            stock,
            category_id
        } = req.body;

        const updates = [];
        const values = [];

        // -------------------------
        // NAME
        // -------------------------

        if (name !== undefined) {
            if (
                typeof name !== "string" ||
                name.trim() === ""
            ) {
                return res.status(400).json({
                    status: "ERROR",
                    message: "name must be a non-empty string"
                });
            }

            updates.push(`name = $${values.length + 1}`);
            values.push(name.trim());
        }

        // -------------------------
        // DESCRIPTION
        // -------------------------

        if (description !== undefined) {
            if (typeof description !== "string") {
                return res.status(400).json({
                    status: "ERROR",
                    message: "description must be a string"
                });
            }

            updates.push(`description = $${values.length + 1}`);
            values.push(description);
        }

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
                    message: "price must be a number greater than 0"
                });
            }

            updates.push(`price = $${values.length + 1}`);
            values.push(price);
        }

        // -------------------------
        // STOCK
        // -------------------------

        if (stock !== undefined) {
            if (!Number.isInteger(stock) || stock < 0) {
                return res.status(400).json({
                    status: "ERROR",
                    message: "stock must be an integer greater than or equal to 0"
                });
            }

            updates.push(`stock = $${values.length + 1}`);
            values.push(stock);
        }

        // -------------------------
        // CATEGORY
        // -------------------------

        if (category_id !== undefined) {
            if (
                typeof category_id !== "string" ||
                category_id.trim() === ""
            ) {
                return res.status(400).json({
                    status: "ERROR",
                    message: "category_id must be a valid string"
                });
            }

            const categoryResult = await pool.query(
                `
                SELECT id
                FROM categories
                WHERE id = $1
                  AND is_active = TRUE
                `,
                [category_id.trim()]
            );

            if (categoryResult.rows.length === 0) {
                return res.status(404).json({
                    status: "ERROR",
                    message: "category not found or inactive"
                });
            }

            updates.push(`category_id = $${values.length + 1}`);
            values.push(category_id.trim());
        }

        // -------------------------
        // NO FIELDS
        // -------------------------

        if (updates.length === 0) {
            return res.status(400).json({
                status: "ERROR",
                message: "no fields provided for update"
            });
        }

        // -------------------------
        // UPDATE PRODUCT
        // -------------------------

        const result = await pool.query(
            `
            UPDATE products
            SET ${updates.join(", ")},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $${values.length + 1}
            RETURNING
                id,
                name,
                description,
                price,
                stock,
                category_id,
                is_available,
                updated_at;
            `,
            [...values, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "product not found"
            });
        }

        return res.status(200).json({
            status: "GOOD",
            message: "product updated successfully",
            product: result.rows[0]
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "internal server error"
        });
    }
};

// -------------------------
// UPDATE PRODUCT IMAGES
// -----------------------


export const updateProductImage = async (req, res) => {
    const { id, imageId } = req.params;
    const { display_order } = req.body;

    // Only allow changing the image position.
    if (
        !Number.isInteger(display_order) ||
        display_order < 1
    ) {
        return res.status(400).json({
            status: "ERROR",
            message: "display_order must be a positive integer",
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Serialize image reorder operations for this product.
        const productResult = await client.query(
            `
      SELECT id
      FROM products
      WHERE id = $1
      FOR UPDATE;
      `,
            [id]
        );

        if (productResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                status: "ERROR",
                message: "Product not found",
            });
        }

        // Get the image we want to move.
        const imageResult = await client.query(
            `
      SELECT id, display_order
      FROM product_images
      WHERE id = $1
        AND product_id = $2
      FOR UPDATE;
      `,
            [imageId, id]
        );

        if (imageResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                status: "ERROR",
                message: "Product image not found",
            });
        }

        const currentOrder = imageResult.rows[0].display_order;

        // Nothing to change.
        if (currentOrder === display_order) {
            await client.query("COMMIT");

            return res.status(200).json({
                status: "GOOD",
                message: "Image already has this position",
                image: imageResult.rows[0],
            });
        }

        // Find the image currently occupying the target position.
        const targetResult = await client.query(
            `
      SELECT id, display_order
      FROM product_images
      WHERE product_id = $1
        AND display_order = $2
      FOR UPDATE;
      `,
            [id, display_order]
        );

        // If target position is occupied, swap positions.
        if (targetResult.rows.length > 0) {
            const targetImage = targetResult.rows[0];

            // Use a temporary position to avoid UNIQUE conflicts.
            const temporaryResult = await client.query(
                `
        SELECT COALESCE(MAX(display_order), 0) + 1
          AS temporary_order
        FROM product_images
        WHERE product_id = $1;
        `,
                [id]
            );

            const temporaryOrder = Number(
                temporaryResult.rows[0].temporary_order
            );

            // Move the selected image to a free position.
            await client.query(
                `
        UPDATE product_images
        SET display_order = $1
        WHERE id = $2
          AND product_id = $3;
        `,
                [temporaryOrder, imageId, id]
            );

            // Move the previous target image to the old position.
            await client.query(
                `
        UPDATE product_images
        SET display_order = $1
        WHERE id = $2
          AND product_id = $3;
        `,
                [currentOrder, targetImage.id, id]
            );
        }

        // Move selected image to its final position.
        const updatedResult = await client.query(
            `
      UPDATE product_images
      SET display_order = $1
      WHERE id = $2
        AND product_id = $3
      RETURNING
        id,
        image_url,
        display_order,
        product_id;
      `,
            [display_order, imageId, id]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            status: "GOOD",
            message: "Image position updated successfully",
            image: updatedResult.rows[0],
        });
    } catch (error) {
        await client.query("ROLLBACK");

        console.error("Update product image error:", error);

        if (error.code === "23505") {
            return res.status(409).json({
                status: "ERROR",
                message: "Image position conflict",
            });
        }

        if (error.code === "22P02") {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid product or image ID",
            });
        }

        return res.status(500).json({
            status: "ERROR",
            message: "Could not update product image",
        });
    } finally {
        client.release();
    }
};



export const deleteProductImage = async (req, res) => {
    const { id, imageId } = req.params;

    try {
        // 1. Buscar la imagen antes de eliminarla
        const imageResult = await pool.query(
            `
            SELECT
                id,
                image_url,
                cloudinary_public_id,
                display_order,
                product_id
            FROM product_images
            WHERE id = $1
              AND product_id = $2;
            `,
            [imageId, id]
        );

        if (imageResult.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product image not found"
            });
        }

        const image = imageResult.rows[0];

        // 2. Eliminar el archivo de Cloudinary, si existe
        if (image.cloudinary_public_id) {
            const cloudinaryResult = await deleteImageFromCloudinary(
                image.cloudinary_public_id
            );

            if (
                !["ok", "not found"].includes(cloudinaryResult.result)
            ) {
                console.error(
                    "Cloudinary deletion failed:",
                    cloudinaryResult
                );

                return res.status(502).json({
                    status: "ERROR",
                    message: "Could not delete image from Cloudinary"
                });
            }
        }

        // 3. Eliminar el registro de PostgreSQL
        const result = await pool.query(
            `
            DELETE FROM product_images
            WHERE id = $1
              AND product_id = $2
            RETURNING
                id,
                image_url,
                display_order,
                product_id;
            `,
            [imageId, id]
        );

        if (result.rows.length === 0) {
            return res.status(409).json({
                status: "ERROR",
                message: "Image record changed during deletion"
            });
        }

        return res.status(200).json({
            status: "GOOD",
            message: "Product image deleted successfully",
            product_image: result.rows[0]
        });

    } catch (error) {
        console.error("Delete product image error:", error);

        if (error.code === "22P02") {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid product or image ID"
            });
        }

        return res.status(500).json({
            status: "ERROR",
            message: "Could not delete product image"
        });
    }
};



export const uploadProductImage = async (req, res) => {
    const { id: productId } = req.params;

    if (!req.file) {
        return res.status(400).json({
            status: "ERROR",
            message: "An image file is required"
        });
    }

    let uploadedImage = null;

    try {
        const detectedType = await fileTypeFromBuffer(req.file.buffer);

        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (!detectedType || !allowedTypes.includes(detectedType.mime)) {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid image format"
            });
        }

        const productResult = await pool.query(
            "SELECT id FROM products WHERE id = $1",
            [productId]
        );

        if (productResult.rows.length === 0) {
            return res.status(404).json({
                status: "ERROR",
                message: "Product not found"
            });
        }

        uploadedImage = await uploadImageToCloudinary(
            req.file.buffer,
            productId
        );

        const imageResult = await pool.query(
            `
            INSERT INTO product_images (
                product_id,
                image_url,
                cloudinary_public_id,
                display_order
            )
            VALUES (
                $1,
                $2,
                $3,
                (
                    SELECT COALESCE(MAX(display_order), 0) + 1
                    FROM product_images
                    WHERE product_id = $1
                )
            )
            RETURNING
                id,
                product_id,
                image_url,
                cloudinary_public_id,
                display_order
            `,
            [
                productId,
                uploadedImage.image_url,
                uploadedImage.public_id
            ]
        );

        return res.status(201).json({
            status: "GOOD",
            message: "Product image uploaded successfully",
            image: imageResult.rows[0]
        });

    } catch (error) {
        if (uploadedImage?.public_id) {
            try {
                await deleteImageFromCloudinary(uploadedImage.public_id);
            } catch (cleanupError) {
                console.error(
                    "Cloudinary cleanup failed:",
                    cleanupError
                );
            }
        }

        console.error("Upload product image error:", error);

        if (error.code === "23505") {
            return res.status(409).json({
                status: "ERROR",
                message: "Image display order conflict"
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
            message: "Could not upload product image"
        });
    }
};


export const getAdminProducts = async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.price,
        p.stock,
        p.is_available,
        p.category_id,
        c.name AS category_name,
        (
          SELECT pi.image_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          ORDER BY pi.display_order ASC, pi.id ASC
          LIMIT 1
        ) AS image_url
      FROM products p
      LEFT JOIN categories c
        ON c.id = p.category_id
      ORDER BY p.name ASC;
    `);

        return res.status(200).json({
            status: "GOOD",
            products: result.rows
        });
    } catch (error) {
        console.error("Get admin products error:", error);

        return res.status(500).json({
            status: "ERROR",
            message: "Could not retrieve products"
        });
    }
};
