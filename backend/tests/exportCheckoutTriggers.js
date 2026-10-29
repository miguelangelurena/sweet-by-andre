
import { pool } from "../src/config/database.js";

async function main() {
    try {
        const database = await pool.query(
            "SELECT current_database() AS name"
        );

        if (
            database.rows[0].name !==
            "sweet_by_andre_test"
        ) {
            throw new Error(
                "This script must run against the test database"
            );
        }

        const result = await pool.query(`
            SELECT
                c.relname AS table_name,
                t.tgname AS trigger_name,
                pg_get_triggerdef(t.oid, true)
                    AS trigger_definition,
                p.proname AS function_name,
                pg_get_functiondef(p.oid)
                    AS function_definition
            FROM pg_trigger t
            JOIN pg_class c
                ON c.oid = t.tgrelid
            JOIN pg_proc p
                ON p.oid = t.tgfoid
            JOIN pg_namespace n
                ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND t.tgname IN (
                  'trg_protect_checkout_order',
                  'trg_protect_checkout_order_items'
              )
              AND NOT t.tgisinternal
            ORDER BY t.tgname
        `);

        if (result.rowCount !== 2) {
            throw new Error(
                `Expected 2 triggers, found ${result.rowCount}`
            );
        }

        for (const row of result.rows) {
            console.log("\n================================");
            console.log("TABLE:", row.table_name);
            console.log("TRIGGER:", row.trigger_name);
            console.log("FUNCTION:", row.function_name);

            console.log("\nFUNCTION SQL:");
            console.log(row.function_definition);

            console.log("\nTRIGGER SQL:");
            console.log(row.trigger_definition + ";");
        }

    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error("Trigger export failed:", error);
    process.exitCode = 1;
});
