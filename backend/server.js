
import "dotenv/config";
import app from "./src/app.js";
import { startNotificationWorker } from "./src/services/orderNotifications.service.js";
import { validateProductionRuntime } from "./src/config/hosting.js";
import { assertProductionDatabase } from "./src/config/productionDatabase.js";
import { pool } from "./src/config/database.js";

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
