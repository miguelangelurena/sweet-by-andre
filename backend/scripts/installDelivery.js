import { readFile } from "node:fs/promises";
import { pool } from "../src/config/database.js";

try {
  const { rows: [database] } = await pool.query("SELECT current_database() AS name");
  if (!["sweet_by_andre_dev", "sweet_by_andre_test"].includes(database.name)) {
    throw new Error("This installer is restricted to the local development and test databases");
  }
  await pool.query(await readFile(new URL("../database/delivery.sql", import.meta.url), "utf8"));
  console.log(`Delivery schema ready in ${database.name}`);
} finally { await pool.end(); }
