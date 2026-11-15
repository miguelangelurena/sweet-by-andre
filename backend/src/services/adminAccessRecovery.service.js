import bcrypt from "bcrypt";
import { pool } from "../config/database.js";
import { credentialVersion } from "./authCredentials.js";
import { assertProductionDatabase } from "../config/productionDatabase.js";

export async function recoveryContext(client, env = process.env) {
  const name = (await client.query("SELECT current_database() AS name")).rows[0].name;
  const environment = env.APP_ENV || (env.NODE_ENV === "test" ? "test" : "development");
  if (["development", "test"].includes(environment)) {
    if (!["sweet_by_andre_dev", "sweet_by_andre_test"].includes(name) ||
        !["localhost", "127.0.0.1", "::1"].includes(client.connectionParameters.host))
      throw new Error("Local recovery requires the local development or test database");
  } else if (environment === "production") {
    await assertProductionDatabase(client, env);
  } else if (environment === "staging") {
    if (["sweet_by_andre_dev", "sweet_by_andre_test"].includes(name))
      throw new Error("Staging recovery refuses local development and test databases");
    const marker = (await client.query("SELECT to_regclass('public.deployment_metadata') AS marker")).rows[0].marker;
    if (!marker || (await client.query("SELECT value FROM public.deployment_metadata WHERE key='environment'")).rows[0]?.value !== "staging")
      throw new Error("Recovery database is not marked as staging");
  } else throw new Error("Unsupported recovery environment");
  return { database: name, environment };
}

export async function inspectAdminRecovery(email, { database = pool, env = process.env } = {}) {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254)
    throw new Error("Enter a valid administrator email");
  const client = await database.connect();
  try {
    const context = await recoveryContext(client, env);
    const result = await client.query(`SELECT id,email,password_hash FROM users
      WHERE lower(email)=$1 AND role='admin' AND deleted_at IS NULL`, [email.trim().toLowerCase()]);
    if (result.rows.length !== 1) throw new Error("Exactly one active administrator must match; no account was changed");
    const user = result.rows[0];
    return { ...context, userId: user.id, email: user.email, credentialVersion: credentialVersion(user.password_hash) };
  } finally { client.release(); }
}

export async function resetAdminPassword(plan, password, { database = pool, env = process.env } = {}) {
  if (typeof password !== "string" || password.length < 16 || Buffer.byteLength(password, "utf8") > 72)
    throw new Error("New password must have at least 16 characters and at most 72 UTF-8 bytes");
  if (!plan?.userId || !plan?.database || !plan?.environment || typeof plan?.email !== "string")
    throw new Error("Inspect and confirm the recovery target first");
  const hash = await bcrypt.hash(password, 12);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const context = await recoveryContext(client, env);
    if (context.database !== plan.database || context.environment !== plan.environment)
      throw new Error("Recovery target changed; inspect it again");
    const result = await client.query(`SELECT id,password_hash FROM users
      WHERE id=$1 AND lower(email)=$2 AND role='admin' AND deleted_at IS NULL FOR UPDATE`, [plan.userId, plan.email.toLowerCase()]);
    if (result.rows.length !== 1 || credentialVersion(result.rows[0].password_hash) !== plan.credentialVersion)
      throw new Error("Administrator credentials or access changed; inspect the account again");
    if (result.rows[0].password_hash && await bcrypt.compare(password, result.rows[0].password_hash))
      throw new Error("Choose a password different from the current one");
    await client.query("UPDATE users SET password_hash=$2,updated_at=NOW() WHERE id=$1", [plan.userId, hash]);
    const deleted = await client.query("DELETE FROM public.session WHERE sess->>'userId'=$1", [plan.userId]);
    await client.query("COMMIT");
    return { sessionsRemoved: deleted.rowCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
