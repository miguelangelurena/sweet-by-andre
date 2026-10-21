
import { pool } from "../config/database.js";
import { stripe } from "../config/stripe.js";

export const createCheckoutSession = async (req, res) => {
    const userId = req.user.id;
    const { order_id } = req.body;

    if (typeof order_id !== "string" || !order_id.trim()) {
        return res.status(400).json({
            status: "ERROR",
            message: "order_id is required"
        });
    }

    const client = await pool.connect();
    let sessionCreated = false;

    try {
        await client.query("BEGIN");

        const orderResult = await client.query(
            `
            SELECT id, total, payment_status, order_status
            FROM orders
            WHERE id = $1 AND user_id = $2
            FOR UPDATE;
            `,
            [order_id, userId]
        );

        if (orderResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                status: "ERROR",
                message: "Order not found"
            });
        }

        const order = orderResult.rows[0];

        if (order.payment_status === "paid") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                status: "ERROR",
                message: "Order has already been paid"
            });
        }

        if (order.order_status === "cancelled") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                status: "ERROR",
                message: "Cannot pay for a cancelled order"
            });
        }

        const pendingResult = await client.query(
            `
            SELECT stripe_payment_id
            FROM payments
            WHERE order_id = $1
              AND status = 'pending'
              AND stripe_payment_id IS NOT NULL;
            `,
            [order.id]
        );

        for (const payment of pendingResult.rows) {
            const existingSession =
                await stripe.checkout.sessions.retrieve(
                    payment.stripe_payment_id
                );

            if (
                existingSession.status === "open" &&
                existingSession.url
            ) {
                await client.query("COMMIT");

                return res.status(200).json({
                    status: "GOOD",
                    message: "Existing Checkout session reused",
                    checkout_url: existingSession.url
                });
            }

            if (
                existingSession.status === "complete" &&
                existingSession.payment_status === "paid"
            ) {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    status: "ERROR",
                    message: "Payment completed and is being processed"
                });
            }

            if (existingSession.status === "expired") {
                await client.query(
                    `
                    UPDATE payments
                    SET status = 'failed'
                    WHERE stripe_payment_id = $1
                      AND status = 'pending';
                    `,
                    [payment.stripe_payment_id]
                );
            }
        }

        const amountInCents = Math.round(Number(order.total) * 100);

        if (
            !Number.isSafeInteger(amountInCents) ||
            amountInCents <= 0
        ) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                status: "ERROR",
                message: "Invalid order amount"
            });
        }

        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: `Sweet by Andre order ${order.id}`
                        },
                        unit_amount: amountInCents
                    },
                    quantity: 1
                }
            ],
            metadata: {
                order_id: order.id,
                user_id: userId
            },
            success_url:
                "http://localhost:3000/payment-success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url:
                "http://localhost:3000/payment-cancelled"
        });

        sessionCreated = true;

        await client.query(
            `
            INSERT INTO payments (
                order_id,
                stripe_payment_id,
                amount,
                status
            )
            VALUES ($1, $2, $3, 'pending');
            `,
            [order.id, session.id, order.total]
        );

        await client.query("COMMIT");

        return res.status(201).json({
            status: "GOOD",
            message: "Checkout session created",
            checkout_url: session.url
        });
    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });

        console.error("Stripe Checkout error:", {
            message: error.message,
            type: error.type,
            code: error.code,
            statusCode: error.statusCode,
            sessionCreated
        });

        return res.status(500).json({
            status: "ERROR",
            message: sessionCreated
                ? "Checkout session was created, but its payment record could not be confirmed"
                : "Could not create checkout session"
        });
    } finally {
        client.release();
    }
};
