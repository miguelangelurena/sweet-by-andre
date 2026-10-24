
export class ReservationError extends Error {
    constructor(message, status = 409) {
        super(message);
        this.name = "ReservationError";
        this.status = status;
    }
}

/**
 * Reserves inventory for an existing pending order.
 *
 * IMPORTANT:
 * - The caller must open a transaction with BEGIN.
 * - The caller must COMMIT or ROLLBACK.
 * - The caller must coordinate expiration with Stripe.
 * - Do not invoke this function directly from a public route.
 */
export async function reserveInventoryForOrder(
    client,
    orderId,
    expiresAt
) {
    const expiration = new Date(expiresAt);

    if (
        Number.isNaN(expiration.getTime()) ||
        expiration <= new Date()
    ) {
        throw new ReservationError(
            "Reservation expiration must be in the future",
            400
        );
    }

    // Lock this order to serialize payment attempts.
    const orderResult = await client.query(
        `
        SELECT id, payment_status, order_status
        FROM orders
        WHERE id = $1
        FOR UPDATE
        `,
        [orderId]
    );

    if (!orderResult.rowCount) {
        throw new ReservationError("Order not found", 404);
    }

    const order = orderResult.rows[0];

    if (
        order.payment_status !== "pending" ||
        order.order_status !== "pending"
    ) {
        throw new ReservationError(
            "Order is not eligible for reservation"
        );
    }

    // Refuse duplicate or previously released reservations.
    const previousResult = await client.query(
        `
        SELECT id
        FROM inventory_reservations
        WHERE order_id = $1
        LIMIT 1
        `,
        [orderId]
    );

    if (previousResult.rowCount) {
        throw new ReservationError(
            "Order already has reservation history"
        );
    }

    // Combine multiple cart lines using the same variant.
    const itemsResult = await client.query(
        `
        SELECT
            variant_id,
            SUM(quantity)::bigint AS quantity
        FROM order_items
        WHERE order_id = $1
        GROUP BY variant_id
        ORDER BY variant_id
        `,
        [orderId]
    );

    if (!itemsResult.rowCount) {
        throw new ReservationError("Order has no items");
    }

    const items = itemsResult.rows;

    if (items.some(item => !item.variant_id)) {
        throw new ReservationError(
            "Order contains an item without a variant"
        );
    }

    const reservations = [];

    // All callers must lock variants in this same order.
    for (const item of items) {
        const requestedQuantity = Number(item.quantity);

        if (
            !Number.isSafeInteger(requestedQuantity) ||
            requestedQuantity <= 0
        ) {
            throw new ReservationError(
                "Invalid order quantity"
            );
        }

        const variantResult = await client.query(
            `
            SELECT id, stock, is_available
            FROM product_variants
            WHERE id = $1
            FOR UPDATE
            `,
            [item.variant_id]
        );

        if (!variantResult.rowCount) {
            throw new ReservationError(
                "Product variant no longer exists"
            );
        }

        const variant = variantResult.rows[0];

        if (!variant.is_available) {
            throw new ReservationError(
                "Product variant is unavailable"
            );
        }

        // Keep counting expired reservations until they
        // are explicitly and safely released.
        const reservedResult = await client.query(
            `
            SELECT COALESCE(SUM(quantity), 0) AS reserved
            FROM inventory_reservations
            WHERE variant_id = $1
              AND status = 'reserved'
            `,
            [item.variant_id]
        );

        const currentlyReserved = Number(
            reservedResult.rows[0].reserved
        );

        const available =
            Number(variant.stock) - currentlyReserved;

        if (available < requestedQuantity) {
            throw new ReservationError(
                `Insufficient stock for variant ${item.variant_id}`
            );
        }

        const insertResult = await client.query(
            `
            INSERT INTO inventory_reservations (
                order_id,
                variant_id,
                quantity,
                status,
                expires_at
            )
            VALUES ($1, $2, $3, 'reserved', $4)
            RETURNING
                id,
                order_id,
                variant_id,
                quantity,
                status,
                expires_at
            `,
            [
                orderId,
                item.variant_id,
                requestedQuantity,
                expiration
            ]
        );

        reservations.push(insertResult.rows[0]);
    }

    return reservations;
}
