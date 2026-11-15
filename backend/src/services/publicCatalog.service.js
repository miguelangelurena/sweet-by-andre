import { pool } from "../config/database.js";

// Shared by the API and HTML/structured data so visibility and prices agree.
export async function loadPublicProducts({
  database = pool,
  productId = null,
} = {}) {
  return (
    await database.query(
      `
            SELECT
                p.id,
                p.name,
                p.description,
                p.price,
                p.stock,
                p.inventory_mode,
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
                variant_summary.max_price,
                variant_summary.offer_count,
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
                    MAX(v.price) AS max_price,
                    COUNT(*)::int AS offer_count,
                    COALESCE(SUM(v.stock), 0) AS total_stock

                FROM product_variants v

                WHERE v.product_id = p.id
                  AND v.is_available = TRUE
                  AND (p.inventory_mode = 'made_to_order' OR v.stock > 0)

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
              AND ($1::uuid IS NULL OR p.id = $1)

            ORDER BY p.name;
            `,
      [productId],
    )
  ).rows;
}
