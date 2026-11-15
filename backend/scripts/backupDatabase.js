import "dotenv/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { databaseOptions } from "../src/config/hosting.js";
import { createDatabaseBackup } from "./lib/databaseBackup.js";

try {
  const directory = process.env.BACKUP_DIR || fileURLToPath(new URL("../../tmp/database-backups/", import.meta.url));
  const result = await createDatabaseBackup({ connection: databaseOptions(), directory });
  console.log(`Backup created: ${resolve(result.folder)}`);
  console.log(`Archive verified; ${result.manifest.tables.length} public tables inventoried. Run db:backup:verify to test restoration.`);
} catch {
  console.error("Backup failed. Check PostgreSQL tools (PG_BIN), connection, permissions and disk space. Incomplete folders are not valid backups.");
  process.exitCode = 1;
}
