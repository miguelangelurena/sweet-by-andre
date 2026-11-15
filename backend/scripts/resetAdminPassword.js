import "dotenv/config";
import { createRecoveryTerminal } from "./lib/recoveryTerminal.js";
import { pool } from "../src/config/database.js";
import { inspectAdminRecovery, resetAdminPassword } from "../src/services/adminAccessRecovery.service.js";

let terminal;
try {
  if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Run admin:reset-password in an interactive terminal without arguments or redirected input");
  terminal = createRecoveryTerminal();
  const email = await terminal.ask("Administrator email: ");
  const plan = await inspectAdminRecovery(email);
  console.log(`Recovery target: ${plan.environment} / ${plan.database}`);
  console.log(`Administrator: ${plan.email} (${plan.userId})`);
  console.log("This changes the password and revokes this account's existing authenticated sessions.");
  const password = await terminal.hidden("New password (hidden): ");
  const repeated = await terminal.hidden("Repeat new password (hidden): ");
  if (password !== repeated) throw new Error("Passwords do not match; no account was changed");
  const confirmation = `RESET ${plan.database} ${plan.userId}`;
  if (await terminal.ask(`Type ${confirmation} to apply: `) !== confirmation)
    throw new Error("Recovery cancelled; no account was changed");
  const result = await resetAdminPassword(plan, password);
  console.log(`Password updated. Removed ${result.sessionsRemoved} session record(s). Sign in again using the new password.`);
} catch (error) {
  console.error(error.name === "AbortError" ? "Recovery cancelled; no account was changed" :
    error.code ? "Recovery did not complete; check the environment and database access" : error.message);
  process.exitCode = 1;
} finally { terminal?.close(); await pool.end(); }
