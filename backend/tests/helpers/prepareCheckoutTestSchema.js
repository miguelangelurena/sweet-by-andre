import { readFile } from "node:fs/promises";
import { pool } from "../../src/config/database.js";
import { requireTestDatabase } from "./requireTestDatabase.js";

// These additions already exist in development. Keep the older isolated test
// database compatible without copying customer data or changing development.
const client = await pool.connect();
try {
  await requireTestDatabase(client);
  await client.query("BEGIN");
  await client.query(await readFile(new URL("../fixtures/checkout-support.sql", import.meta.url), "utf8"));
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
