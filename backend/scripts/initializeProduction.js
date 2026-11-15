import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import bcrypt from "bcrypt";
import { pool } from "../src/config/database.js";
import { validateProductionRuntime } from "../src/config/hosting.js";
import { assertProductionDatabase } from "../src/config/productionDatabase.js";

const migrations = ["delivery.sql", "production.sql", "refunds.sql", "notifications.sql", "auth-security.sql"];
const load = name => readFile(new URL(`../database/${name}`, import.meta.url), "utf8");
const stripTransaction = sql => sql.replace(/^BEGIN;\s*/, "").replace(/\s*COMMIT;\s*$/, "");

export async function initializeProduction(client, env = process.env) {
  validateProductionRuntime(env);
  await assertProductionDatabase(client, env, { requireInitialized: false });
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sweet-by-andre-production-setup'))");
    const marker = (await client.query("SELECT to_regclass('public.deployment_metadata') AS marker")).rows[0].marker;
    const fresh = !marker;
    if (fresh) {
      const existing = await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
        AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1`);
      if (existing.rowCount) throw new Error("First production setup requires an empty database; existing data is preserved");
      const email = env.PRODUCTION_ADMIN_EMAIL?.trim().toLowerCase();
      const password = env.PRODUCTION_ADMIN_PASSWORD;
      const first = env.PRODUCTION_ADMIN_FIRST_NAME?.trim();
      const last = env.PRODUCTION_ADMIN_LAST_NAME?.trim();
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error("Set PRODUCTION_ADMIN_EMAIL before first initialization");
      if (typeof password !== "string" || password.length < 16 || Buffer.byteLength(password, "utf8") > 72)
        throw new Error("Set PRODUCTION_ADMIN_PASSWORD: at least 16 characters, at most 72 UTF-8 bytes");
      if (!first || !last || first.length > 100 || last.length > 100)
        throw new Error("Set PRODUCTION_ADMIN_FIRST_NAME and PRODUCTION_ADMIN_LAST_NAME");
      await client.query(await load("bootstrap.sql"));
      await client.query("SET LOCAL search_path TO public,pg_catalog");
      await client.query("CREATE TABLE public.deployment_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)");
      await client.query("INSERT INTO public.deployment_metadata (key,value) VALUES ('environment','production'),('bootstrap_version','1')");
      await client.query(`INSERT INTO public.users (first_name,last_name,email,phone,password_hash,role)
        VALUES ($1,$2,$3,$4,$5,'admin')`, [first, last, email, env.PRODUCTION_ADMIN_PHONE?.trim() || "", await bcrypt.hash(password, 12)]);
    } else {
      await assertProductionDatabase(client, env);
    }
    await client.query(`CREATE TABLE IF NOT EXISTS public.deployment_migrations (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    for (const name of migrations) {
      const sql = await load(name);
      // Ignore line-ending differences between a Windows checkout and Docker.
      const checksum = createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex");
      const applied = (await client.query("SELECT checksum FROM public.deployment_migrations WHERE name=$1", [name])).rows[0];
      if (applied) {
        if (applied.checksum !== checksum) throw new Error("An applied production migration changed; add a new versioned migration instead");
        continue;
      }
      await client.query("SET LOCAL search_path TO public,pg_catalog");
      await client.query(stripTransaction(sql));
      await client.query("INSERT INTO public.deployment_migrations (name,checksum) VALUES ($1,$2)", [name, checksum]);
    }
    if (fresh) {
      // Require approved dates rather than inheriting unlimited demo capacity.
      await client.query(`UPDATE public.production_settings SET config=jsonb_set(config,'{weekly_capacity}',
        '[{"enabled":false,"capacity":null},{"enabled":false,"capacity":null},{"enabled":false,"capacity":null},
        {"enabled":false,"capacity":null},{"enabled":false,"capacity":null},{"enabled":false,"capacity":null},
        {"enabled":false,"capacity":null}]'::jsonb) WHERE id=TRUE`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let client;
  try {
    client = await pool.connect();
    await initializeProduction(client);
    console.log("Production schema ready. No demo catalog imported; existing records and accounts preserved.");
  } catch (error) {
    console.error(error.code ? "Production initialization failed; inspect database access and migration compatibility" : error.message);
    process.exitCode = 1;
  } finally { client?.release(); await pool.end(); }
}
