import { pool } from "../config/database.js";

/** Admin-only, read-only summary. Revenue is captured-order gross, NOT net payouts. */
export async function getAdminDashboard(req, res) {
  try {
    const [orders, products, recent] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS all_orders,
          COUNT(*) FILTER (WHERE payment_status = 'pending')::int AS awaiting_payment,
          COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid_orders,
          COUNT(*) FILTER (WHERE payment_status = 'paid' AND order_status IN ('pending','confirmed','preparing','ready'))::int AS active_orders,
          COUNT(*) FILTER (WHERE payment_status = 'paid' AND order_status = 'pending')::int AS awaiting_acceptance,
          COUNT(*) FILTER (WHERE payment_status = 'paid' AND order_status IN ('pending','confirmed','preparing','ready')
             AND delivery_date::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date
             AND delivery_date::date < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date + 7)::int AS next_seven_days,
          COALESCE(SUM(total) FILTER (WHERE payment_status = 'paid'),0)::numeric(12,2) AS gross_paid_total
        FROM orders
      `),
      pool.query(`SELECT COUNT(*)::int AS listed_products FROM products p JOIN categories c ON c.id=p.category_id WHERE p.is_available=TRUE AND c.is_active=TRUE`),
      pool.query(`SELECT id, shipping_name, total, payment_status, order_status, delivery_date, created_at
                  FROM orders ORDER BY created_at DESC, id DESC LIMIT 6`)
    ]);
    return res.json({ status: "GOOD", summary: { ...orders.rows[0], ...products.rows[0] }, recent_orders: recent.rows });
  } catch (error) {
    console.error("Admin dashboard failed:", error);
    return res.status(500).json({ status: "ERROR", message: "Could not load dashboard" });
  }
}
