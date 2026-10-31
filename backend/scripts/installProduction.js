import { readFile } from "node:fs/promises";
import { pool } from "../src/config/database.js";

try {
  const {
    rows: [database],
  } = await pool.query("SELECT current_database() AS name");
  if (!["sweet_by_andre_dev", "sweet_by_andre_test"].includes(database.name))
    throw new Error(
      "Installer restricted to local development and test databases",
    );
  await pool.query(
    await readFile(
      new URL("../database/production.sql", import.meta.url),
      "utf8",
    ),
  );
  if (process.argv.includes("--convert-catalog")) {
    if (database.name !== "sweet_by_andre_dev")
      throw new Error("Catalog conversion is restricted to development");
    const result = await pool.query(
      "UPDATE products SET inventory_mode='made_to_order' WHERE inventory_mode='stock'",
    );
    console.log(
      `${result.rowCount} catalog products switched to made to order. Historical order snapshots and stock quantities preserved.`,
    );
  }
  console.log(`Production schema ready in ${database.name}`);
} finally {
  await pool.end();
}
