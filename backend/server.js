
import "dotenv/config";
import app from "./src/app.js";
import { startNotificationWorker } from "./src/services/orderNotifications.service.js";
import { validateProductionRuntime, validateStagingRuntime } from "./src/config/hosting.js";
import { assertProductionDatabase } from "./src/config/productionDatabase.js";
import { pool } from "./src/config/database.js";

if (process.env.NODE_ENV === "production" && !["staging", "production"].includes(process.env.APP_ENV))
  throw new Error("Hosted runtime requires an explicit staging or production environment");
if (process.env.APP_ENV === "staging") validateStagingRuntime();
if (process.env.APP_ENV === "production") {
  validateProductionRuntime();
  await assertProductionDatabase(pool);
}

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server listening on port: ${PORT}`);
  const worker = startNotificationWorker();
  if (worker) server.once("close", () => clearInterval(worker));
});
