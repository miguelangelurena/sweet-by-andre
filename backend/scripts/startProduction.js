import "dotenv/config";
import { pool } from "../src/config/database.js";
import { validateProductionRuntime } from "../src/config/hosting.js";
import { initializeProduction } from "./initializeProduction.js";

try {
  validateProductionRuntime();
  const client = await pool.connect();
  try { await initializeProduction(client); } finally { client.release(); }
  console.log("Production database ready. Checkout, refunds and notifications remain disabled.");
  await import("../server.js");
} catch (error) {
  console.error(error.code ? "Production startup failed; inspect database access and migrations" : error.message);
  await pool.end();
  process.exitCode = 1;
}
