
import { pool } from "../src/config/database.js";

async function audit() {
    try {
        const database = await pool.query(
            "SELECT current_database() AS name"
        );

        console.log(
            "\nDATABASE:",
            database.rows[0].name
        );

        const indexes = await pool.query(`
            SELECT
                tablename,
                indexname,
                indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename IN (
                  'orders',
                  'order_items',
                  'payments',
                  'checkout_attempts',
                  'inventory_reservations'
              )
            ORDER BY tablename, indexname
        `);

        console.log("\nCHECKOUT INDEXES");

        for (const row of indexes.rows) {
            console.log(
                `\n${row.tablename} / ${row.indexname}`
            );
            console.log(row.indexdef);
        }

        const triggers = await pool.query(`
            SELECT
                event_object_table AS table_name,
                trigger_name,
                action_timing,
                event_manipulation
            FROM information_schema.triggers
            WHERE event_object_schema = 'public'
              AND event_object_table IN (
                  'orders',
                  'order_items',
                  'payments',
                  'checkout_attempts'
              )
            ORDER BY table_name, trigger_name
        `);

        console.log("\nCHECKOUT TRIGGERS");
        console.table(triggers.rows);

        const constraints = await pool.query(`
            SELECT
                conrelid::regclass::text AS table_name,
                conname AS constraint_name,
                pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
            WHERE conrelid IN (
                'orders'::regclass,
                'order_items'::regclass,
                'payments'::regclass,
                'checkout_attempts'::regclass,
                'inventory_reservations'::regclass
            )
            ORDER BY table_name, constraint_name
        `);

        console.log("\nCHECKOUT CONSTRAINTS");
        console.table(constraints.rows);

    } finally {
        await pool.end();
    }
}

audit().catch(error => {
    console.error("Checkout database audit failed:", error);
    process.exitCode = 1;
});
