import "dotenv/config";
import { pool } from "../src/config/database.js";
import { validateStagingRuntime } from "../src/config/hosting.js";
import { initializeStaging } from "./initializeStaging.js";

try {
  validateStagingRuntime();
  const client = await pool.connect();
  try {
    await initializeStaging(client, {
      email: process.env.STAGING_ADMIN_EMAIL,
      password: process.env.STAGING_ADMIN_PASSWORD,
    });
  } finally {
    client.release();
  }
  console.log(
    "Staging database ready. Catalog and administrator configured; existing staging edits preserved.",
  );
  // Keep the shared pool open for the API and run Node as the server process.
  await import("../server.js");
} catch (error) {
  console.error(error.message);
  await pool.end();
  process.exitCode = 1;
}
