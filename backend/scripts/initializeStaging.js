import "dotenv/config";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import bcrypt from "bcrypt";
import { pool } from "../src/config/database.js";
import { validateStagingRuntime } from "../src/config/hosting.js";

const CATALOG_TABLES = [
  "categories",
  "products",
  "product_options",
  "product_option_values",
  "product_variants",
  "product_variant_values",
  "product_images",
  "seasonal_collections",
  "seasonal_collection_products",
];
const withoutTransaction = (sql) =>
  sql.replace(/^BEGIN;\s*/, "").replace(/\s*COMMIT;\s*$/, "");
const loadSql = async (name) =>
  readFile(new URL(`../database/${name}`, import.meta.url), "utf8");

export async function initializeStaging(client, { email, password }) {
  validateStagingRuntime();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Set STAGING_ADMIN_EMAIL before the first deployment");
  const database = (await client.query("SELECT current_database() AS name"))
    .rows[0].name;
  if (["sweet_by_andre_dev", "sweet_by_andre_test"].includes(database))
    throw new Error(
      "Staging setup refuses the local development and regression databases",
    );
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('sweet-by-andre-staging-setup'))",
    );
    const marker = (
      await client.query(
        "SELECT to_regclass('public.deployment_metadata') AS marker",
      )
    ).rows[0].marker;
    if (!marker) {
      const tables = await client.query(
        "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') LIMIT 1",
      );
      if (tables.rowCount)
        throw new Error(
          "First staging setup requires an empty database; existing application data will not be overwritten",
        );
      if (typeof password !== "string" || password.length < 16)
        throw new Error(
          "Set STAGING_ADMIN_PASSWORD to a unique password with at least 16 characters",
        );
      await client.query(await loadSql("bootstrap.sql"));
      await client.query("SET LOCAL search_path TO public,pg_catalog");
      await client.query(
        "CREATE TABLE public.deployment_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)",
      );
      const catalog = JSON.parse(
        await readFile(
          new URL("../database/demo-catalog.json", import.meta.url),
          "utf8",
        ),
      );
      if (
        catalog.version !== 1 ||
        Object.keys(catalog.tables).some(
          (name) => !CATALOG_TABLES.includes(name),
        )
      )
        throw new Error("Unsupported demo catalog format");
      for (const table of CATALOG_TABLES) {
        for (const raw of catalog.tables[table] ?? []) {
          const row = { ...raw };
          if (table === "product_images") row.cloudinary_public_id = null;
          const columns = Object.keys(row);
          if (columns.some((key) => !/^[a-z_]+$/.test(key)))
            throw new Error("Invalid demo catalog column");
          await client.query(
            `INSERT INTO public.${table} (${columns.map((key) => `"${key}"`).join(",")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(",")})`,
            columns.map((key) => row[key]),
          );
        }
      }
      const hash = await bcrypt.hash(password, 12);
      await client.query(
        `INSERT INTO public.users (first_name,last_name,email,phone,password_hash,role)
        VALUES ('Andrea','Preview',$1,'0000000000',$2,'admin')`,
        [email.trim().toLowerCase(), hash],
      );
      await client.query(
        "INSERT INTO public.deployment_metadata (key,value) VALUES ('environment','staging'),('bootstrap_version','1')",
      );
    } else {
      const env = (
        await client.query(
          "SELECT value FROM public.deployment_metadata WHERE key='environment'",
        )
      ).rows[0]?.value;
      if (env !== "staging")
        throw new Error("Database is not marked as staging");
    }
    // Additive, repeatable migrations keep existing catalog edits and accounts.
    await client.query(withoutTransaction(await loadSql("delivery.sql")));
    await client.query(withoutTransaction(await loadSql("production.sql")));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let client;
  try {
    client = await pool.connect();
    await initializeStaging(client, {
      email: process.env.STAGING_ADMIN_EMAIL,
      password: process.env.STAGING_ADMIN_PASSWORD,
    });
    console.log(
      "Staging database ready. Catalog and administrator configured; existing staging edits preserved.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}
