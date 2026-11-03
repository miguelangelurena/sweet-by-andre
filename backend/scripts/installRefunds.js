import { readFile } from "node:fs/promises";
import { pool } from "../src/config/database.js";

try {
  const name = (await pool.query("SELECT current_database() AS name")).rows[0].name;
  if (!["sweet_by_andre_dev", "sweet_by_andre_test"].includes(name))
    throw new Error("Installer restricted to local development and test databases");
  await pool.query(await readFile(new URL("../database/refunds.sql", import.meta.url), "utf8"));
  console.log(`Refund schema ready in ${name}`);
} finally { await pool.end(); }
