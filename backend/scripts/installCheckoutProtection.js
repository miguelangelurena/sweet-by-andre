
import { pool } from "../src/config/database.js";

/**
 * Installs Checkout protection triggers.
 *
 * Target: sweet_by_andre_dev ONLY.
 * Uses the definitions verified in the test DB.
 *
 * All changes run inside one transaction.
 */

const ORDER_FUNCTION = `
CREATE OR REPLACE FUNCTION public.protect_checkout_order()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM checkout_attempts
        WHERE order_id = OLD.id
    ) THEN
        IF (
            OLD.user_id,
            OLD.guest_cart_id,
            OLD.shipping_name,
            OLD.shipping_street,
            OLD.shipping_street_number,
            OLD.shipping_unit,
            OLD.shipping_city,
            OLD.shipping_state,
            OLD.shipping_zip_code,
            OLD.delivery_instructions,
            OLD.note,
            OLD.delivery_date,
            OLD.subtotal,
            OLD.shipping_cost,
            OLD.tax_amount,
            OLD.total,
            OLD.customer_email,
            OLD.customer_phone
        ) IS DISTINCT FROM (
            NEW.user_id,
            NEW.guest_cart_id,
            NEW.shipping_name,
            NEW.shipping_street,
            NEW.shipping_street_number,
            NEW.shipping_unit,
            NEW.shipping_city,
            NEW.shipping_state,
            NEW.shipping_zip_code,
            NEW.delivery_instructions,
            NEW.note,
            NEW.delivery_date,
            NEW.subtotal,
            NEW.shipping_cost,
            NEW.tax_amount,
            NEW.total,
            NEW.customer_email,
            NEW.customer_phone
        ) THEN
            RAISE EXCEPTION
                'Order cannot be modified after Checkout starts';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
`;

const ITEMS_FUNCTION = `
CREATE OR REPLACE FUNCTION public.protect_checkout_order_items()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    affected_order_id UUID;
BEGIN
    FOR affected_order_id IN
        SELECT DISTINCT id
        FROM (
            SELECT CASE
                WHEN TG_OP IN ('UPDATE', 'DELETE')
                THEN OLD.order_id
                ELSE NULL::uuid
            END AS id

            UNION ALL

            SELECT CASE
                WHEN TG_OP IN ('INSERT', 'UPDATE')
                THEN NEW.order_id
                ELSE NULL::uuid
            END AS id
        ) affected
        WHERE id IS NOT NULL
        ORDER BY id
    LOOP
        PERFORM 1
        FROM orders
        WHERE id = affected_order_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Order does not exist: %',
                affected_order_id;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM checkout_attempts
            WHERE order_id = affected_order_id
        ) THEN
            RAISE EXCEPTION
                'Order items cannot be modified after Checkout starts';
        END IF;
    END LOOP;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$function$;
`;

const EXPECTED_TRIGGERS = [
    "trg_protect_checkout_order",
    "trg_protect_checkout_order_items"
];

async function main() {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
        await client.query("BEGIN");
        transactionStarted = true;

        const database = await client.query(
            "SELECT current_database() AS name"
        );

        const databaseName = database.rows[0].name;

        console.log("Connected database:", databaseName);

        if (databaseName !== "sweet_by_andre_dev") {
            throw new Error(
                "Migration refused: expected sweet_by_andre_dev"
            );
        }

        await client.query(
            "SET LOCAL search_path TO public, pg_catalog"
        );

        // Do not overwrite existing triggers unexpectedly.
        const existing = await client.query(
            `
            SELECT tgname
            FROM pg_trigger
            WHERE tgname = ANY($1::text[])
              AND tgrelid IN (
                  'public.orders'::regclass,
                  'public.order_items'::regclass
              )
              AND NOT tgisinternal
            `,
            [EXPECTED_TRIGGERS]
        );

        if (existing.rowCount > 0) {
            throw new Error(
                "Checkout protection triggers already exist. " +
                "Review the database before rerunning migration."
            );
        }

        // Install the original tested functions.
        await client.query(ORDER_FUNCTION);
        await client.query(ITEMS_FUNCTION);

        await client.query(`
            CREATE TRIGGER trg_protect_checkout_order
            BEFORE UPDATE ON public.orders
            FOR EACH ROW
            EXECUTE FUNCTION public.protect_checkout_order()
        `);

        await client.query(`
            CREATE TRIGGER trg_protect_checkout_order_items
            BEFORE INSERT OR DELETE OR UPDATE
            ON public.order_items
            FOR EACH ROW
            EXECUTE FUNCTION public.protect_checkout_order_items()
        `);

        // Verify both triggers before committing.
        const verification = await client.query(
            `
            SELECT
                c.relname AS table_name,
                t.tgname AS trigger_name,
                t.tgenabled AS enabled
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND t.tgname = ANY($1::text[])
              AND NOT t.tgisinternal
            ORDER BY t.tgname
            `,
            [EXPECTED_TRIGGERS]
        );

        if (
            verification.rowCount !== 2 ||
            verification.rows.some(row => row.enabled !== "O")
        ) {
            throw new Error(
                "Checkout trigger verification failed"
            );
        }

        await client.query("COMMIT");
        transactionStarted = false;

        console.log("\nCheckout protection installed.");
        console.table(verification.rows);

    } catch (error) {
        if (transactionStarted) {
            await client.query("ROLLBACK").catch(() => { });
        }

        throw error;

    } finally {
        client.release();
    }
}

try {
    await main();
} catch (error) {
    console.error("\nMigration failed:", error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
