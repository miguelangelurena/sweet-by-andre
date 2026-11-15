import "dotenv/config";
import { databaseOptions } from "../src/config/hosting.js";
import { verifyDatabaseBackup } from "./lib/databaseBackup.js";

try {
  const folder = process.argv[2];
  if (!folder || process.argv.length !== 3) throw new Error("Usage: npm run db:backup:verify -- <backup folder>");
  const result = await verifyDatabaseBackup({ connection: databaseOptions(), folder });
  console.log(`Restoration verified: ${result.tables} public tables, ${result.rows} rows. Temporary database removed; application database unchanged.`);
} catch {
  console.error("Restore verification failed. Use a trusted, complete backup folder and local PostgreSQL with CREATE DATABASE permission. Check tools, disk space and archive integrity.");
  process.exitCode = 1;
}
