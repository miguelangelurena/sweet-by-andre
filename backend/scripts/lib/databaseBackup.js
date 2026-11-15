import { Client } from "pg";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const RESTORE_PREFIX = "sweet_by_andre_restore_";
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const quote = value => `"${String(value).replaceAll('"', '""')}"`;

export async function pgTool(name, binDirectory = process.env.PG_BIN) {
  const executable = `${name}${process.platform === "win32" ? ".exe" : ""}`;
  if (binDirectory) {
    const path = join(resolve(binDirectory), executable);
    await access(path);
    return path;
  }
  if (process.platform === "win32") {
    const path = join(process.env.ProgramFiles || "C:\\Program Files", "PostgreSQL", "18", "bin", executable);
    try { await access(path); return path; } catch { /* Try PATH. */ }
  }
  return executable;
}

function toolEnvironment(parameters, database = parameters.database) {
  if (typeof parameters.password !== "string" && parameters.password != null)
    throw new Error("Backup requires a password value or configured PostgreSQL credentials");
  if (parameters.ssl?.rejectUnauthorized === false)
    throw new Error("Backup refuses TLS with certificate verification disabled");
  const env = {
    ...process.env,
    PGHOST: parameters.host, PGPORT: String(parameters.port),
    PGDATABASE: database, PGUSER: parameters.user,
    PGPASSWORD: parameters.password || "",
    PGSSLMODE: parameters.ssl ? "verify-full" : "disable",
    PGCONNECT_TIMEOUT: "10",
    PGAPPNAME: "sweet-by-andre-backup",
  };
  // Empty PGSERVICE still requests a service on some libpq versions. Remove
  // inherited service/option overrides instead of passing empty values.
  for (const key of ["PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGPASSFILE"])
    delete env[key];
  return env;
}

async function runTool(name, args, env, binDirectory) {
  const executable = await pgTool(name, binDirectory);
  await new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { env, shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    // Classify diagnostics without exposing connection details or row values.
    let diagnostic = "";
    child.stderr.on("data", chunk => { if (diagnostic.length < 16000) diagnostic += chunk.toString(); });
    const timer = setTimeout(() => { child.kill(); }, 10 * 60 * 1000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error(`${name} could not start; check PG_BIN and installed PostgreSQL tools`));
    });
    child.once("close", code => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else {
        const reasons = [
          [/version mismatch|server version/i, "PostgreSQL client/server version mismatch"],
          [/password authentication failed|no password supplied/i, "PostgreSQL authentication failed"],
          [/service.*not found|service file/i, "invalid libpq service configuration"],
          [/invalid snapshot|snapshot identifier/i, "snapshot unavailable"],
          [/permission denied/i, "insufficient permissions"],
          [/could not connect|connection.*failed/i, "database connection failed"],
          [/unrecognized option|invalid option/i, "unsupported PostgreSQL tool option"],
        ];
        const reason = reasons.find(([pattern]) => pattern.test(diagnostic))?.[1] || "check tools, permissions, connection and disk space";
        reject(new Error(`${name} failed: ${reason}`));
      }
    });
  });
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

// Row counts and order-independent fingerprints reveal lost or changed values
// without writing customer data to the manifest. Both sides use UTC formatting.
export async function databaseFingerprint(client) {
  await client.query("SET TIME ZONE 'UTC'");
  await client.query("SET datestyle TO 'ISO, YMD'");
  const relations = (await client.query(`
    SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname='public'
    ORDER BY n.nspname,c.relname
  `)).rows;
  const tables = [];
  for (const relation of relations) {
    const data = (await client.query(`SELECT COUNT(*)::text AS rows,
      COALESCE(bit_xor(('x' || substr(md5(row_to_json(t)::text),1,16))::bit(64)::bigint),0)::text AS fingerprint
      FROM ${quote(relation.schema)}.${quote(relation.name)} t`)).rows[0];
    tables.push({ ...relation, ...data });
  }
  return tables;
}

export async function createDatabaseBackup({ connection, directory, binDirectory }) {
  const client = new Client(connection);
  let connected = false;
  try {
    await client.connect(); connected = true;
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const metadata = (await client.query("SELECT current_database() AS database, current_setting('server_version') AS version, pg_export_snapshot() AS snapshot")).rows[0];
    const tables = await databaseFingerprint(client);
    await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
    const folder = await mkdtemp(join(resolve(directory), `backup-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-`));
    const partial = join(folder, "database.dump.partial");
    const archive = join(folder, "database.dump");
    await runTool("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--no-password",
      `--snapshot=${metadata.snapshot}`, `--file=${partial}`], toolEnvironment(client.connectionParameters), binDirectory);
    await runTool("pg_restore", ["--list", partial], toolEnvironment(client.connectionParameters), binDirectory);
    const manifest = {
      format: 1, createdAt: new Date().toISOString(), database: metadata.database,
      serverVersion: metadata.version, scope: "public table data; full database archive",
      archive: "database.dump", bytes: (await stat(partial)).size,
      sha256: await sha256(partial), tables,
    };
    await client.query("COMMIT");
    await rename(partial, archive);
    // A folder without a complete manifest is never accepted for verification.
    await writeFile(join(folder, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return { folder, manifest };
  } finally {
    if (connected) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export async function verifyDatabaseBackup({ connection, folder, binDirectory }) {
  // Verify integrity before opening a database or executing archive contents.
  const manifest = JSON.parse(await readFile(join(resolve(folder), "manifest.json"), "utf8"));
  if (manifest.format !== 1 || manifest.archive !== "database.dump" || !Array.isArray(manifest.tables))
    throw new Error("Unsupported or incomplete backup manifest");
  const archive = join(resolve(folder), "database.dump");
  if ((await stat(archive)).size !== manifest.bytes || (await sha256(archive)) !== manifest.sha256)
    throw new Error("Backup integrity check failed; archive differs from its manifest");
  const probe = new Client(connection);
  const parameters = probe.connectionParameters;
  // There is intentionally no restore-target option. Only a random database on
  // a local PostgreSQL server is eligible, never the database in DATABASE_URL.
  if (!localHosts.has(parameters.host)) throw new Error("Restore verification is restricted to local PostgreSQL");
  const base = {
    host: parameters.host, port: parameters.port, user: parameters.user,
    password: parameters.password, ssl: parameters.ssl,
    connectionTimeoutMillis: 10000,
  };
  const management = new Client({ ...base, database: "postgres" });
  const name = `${RESTORE_PREFIX}${randomBytes(8).toString("hex")}`;
  let created = false, restored;
  try {
    await management.connect();
    await management.query(`CREATE DATABASE ${quote(name)} TEMPLATE template0`);
    created = true;
    await runTool("pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges",
      "--no-password", `--dbname=${name}`, archive], toolEnvironment(parameters, name), binDirectory);
    restored = new Client({ ...base, database: name });
    await restored.connect();
    await restored.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = await databaseFingerprint(restored);
    if (JSON.stringify(tables) !== JSON.stringify(manifest.tables))
      throw new Error("Restored data differs from the backup snapshot");
    await restored.query("COMMIT");
    return { tables: tables.length, rows: tables.reduce((sum, table) => sum + BigInt(table.rows), 0n).toString() };
  } finally {
    await restored?.end();
    // Drop only the database this invocation successfully created.
    try {
      if (created && /^sweet_by_andre_restore_[0-9a-f]{16}$/.test(name))
        await management.query(`DROP DATABASE ${quote(name)}`);
    } finally { await management.end(); }
  }
}
