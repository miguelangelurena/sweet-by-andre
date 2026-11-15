import { readFile } from "node:fs/promises";
import { pool } from "../src/config/database.js";

try {
  const name = (await pool.query("SELECT current_database() AS name")).rows[0].name;
  if (!["sweet_by_andre_dev", "sweet_by_andre_test"].includes(name))
    throw new Error("Installer restricted to local development and test databases");
  await pool.query(await readFile(new URL("../database/auth-security.sql", import.meta.url), "utf8"));
  if (process.argv.includes("--reset-test-counters")) {
    if (name !== "sweet_by_andre_test") throw new Error("Counter reset restricted to the test database");
    await pool.query("DELETE FROM public.auth_rate_limits");
  }
  console.log(`Authentication protection ready in ${name}`);
} finally { await pool.end(); }
