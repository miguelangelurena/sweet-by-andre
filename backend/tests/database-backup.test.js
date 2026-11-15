import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { appendFile, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { databaseOptions } from "../src/config/hosting.js";
import { createDatabaseBackup, verifyDatabaseBackup } from "../scripts/lib/databaseBackup.js";

test("a real PostgreSQL archive restores bakery records without touching the source", { timeout: 60000 }, async t => {
  // Two disposable local databases only. No application server, Stripe or email
  // worker is started, and no existing development/test records are exported.
  const probe = new Client(databaseOptions());
  const config = probe.connectionParameters;
  if (!["localhost", "127.0.0.1", "::1"].includes(config.host))
    throw new Error("Backup validation requires local PostgreSQL");
  const base = { host: config.host, port: config.port, user: config.user, password: config.password, ssl: config.ssl, connectionTimeoutMillis: 10000 };
  const management = new Client({ ...base, database: "postgres" });
  const name = `sweet_by_andre_backup_test_${randomBytes(8).toString("hex")}`;
  const directory = await mkdtemp(join(tmpdir(), "sweet-by-andre-backup-test-"));
  let source, created = false;
  try {
    await management.connect();
    await management.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    source = new Client({ ...base, database: name });
    await source.connect();
    await source.query(await readFile(new URL("../database/bootstrap.sql", import.meta.url), "utf8"));
    await source.query("SET search_path TO public,pg_catalog");
    const user = (await source.query(`INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
      VALUES ('Backup','Fixture','backup@example.com','5550000000','not-a-real-login','admin') RETURNING id`)).rows[0].id;
    const category = (await source.query("INSERT INTO categories (name) VALUES ('Backup fixture') RETURNING id")).rows[0].id;
    const product = (await source.query("INSERT INTO products (name,price,stock,category_id) VALUES ('Synthetic chocoflan',6.99,7,$1) RETURNING id", [category])).rows[0].id;
    const variant = (await source.query("INSERT INTO product_variants (product_id,price,stock) VALUES ($1,6.99,7) RETURNING id", [product])).rows[0].id;
    const order = (await source.query(`INSERT INTO orders (user_id,shipping_name,shipping_street,shipping_street_number,
      shipping_city,shipping_state,shipping_zip_code,delivery_date,subtotal,shipping_cost,tax_amount,total,
      payment_status,order_status,customer_email)
      VALUES ($1,'Backup Fixture','Test Street','123','Houston','TX','77001',NOW()+INTERVAL '5 days',13.98,0,0,13.98,
      'pending','pending','backup@example.com') RETURNING id`, [user])).rows[0].id;
    await source.query("INSERT INTO order_items (order_id,product_id,variant_id,quantity,unit_price,product_name_snapshot) VALUES ($1,$2,$3,2,6.99,'Synthetic chocoflan')", [order, product, variant]);
    await source.query("INSERT INTO payments (order_id,amount,status,stripe_payment_id) VALUES ($1,13.98,'succeeded','pi_synthetic_backup')", [order]);
    await source.query("UPDATE orders SET payment_status='paid' WHERE id=$1", [order]);
    await source.query("INSERT INTO auth_rate_limits (key,attempts,expires_at) VALUES ('synthetic',2,NOW()+INTERVAL '15 minutes')");
    const backup = await createDatabaseBackup({ connection: { ...base, database: name }, directory });
    assert.equal(backup.manifest.database, name);
    assert.ok(backup.manifest.bytes > 0);
    assert.equal(backup.manifest.tables.find(table => table.name === "orders").rows, "1");
    assert.equal(backup.manifest.tables.find(table => table.name === "order_notification_outbox").rows, "1");
    assert.equal(JSON.stringify(backup.manifest).includes("backup@example.com"), false);

    await t.test("restoration verifies the snapshot after the source has changed", async () => {
      await source.query("UPDATE product_variants SET stock=99 WHERE id=$1", [variant]);
      const result = await verifyDatabaseBackup({ connection: { ...base, database: name }, folder: backup.folder });
      assert.equal(result.tables, backup.manifest.tables.length);
      assert.equal((await source.query("SELECT stock FROM product_variants WHERE id=$1", [variant])).rows[0].stock, 99);
    });
    await t.test("a remote restore target is refused before any connection", async () => {
      await assert.rejects(verifyDatabaseBackup({ connection: { host: "production.invalid", database: "bakery", user: "test" }, folder: backup.folder }), /restricted to local/);
    });
    await t.test("a changed data fingerprint cannot pass restoration verification", async () => {
      const manifestPath = join(backup.folder, "manifest.json");
      const original = await readFile(manifestPath, "utf8");
      const changed = JSON.parse(original);
      changed.tables.find(table => table.name === "orders").rows = "99";
      const { writeFile } = await import("node:fs/promises");
      await writeFile(manifestPath, JSON.stringify(changed));
      await assert.rejects(verifyDatabaseBackup({ connection: base, folder: backup.folder }), /differs from the backup/);
      await writeFile(manifestPath, original);
    });
    await t.test("corruption is rejected before a restore database is created", async () => {
      await appendFile(join(backup.folder, "database.dump"), "corrupt");
      await assert.rejects(verifyDatabaseBackup({ connection: base, folder: backup.folder }), /integrity check failed/);
    });
  } finally {
    await source?.end();
    try {
      if (created && /^sweet_by_andre_backup_test_[0-9a-f]{16}$/.test(name))
        await management.query(`DROP DATABASE "${name}"`);
    } finally { await management.end(); }
    // Validate the resolved cleanup target before recursively removing only
    // this test's generated files, including on Windows and redirected TEMP.
    const actual = await realpath(directory);
    const parent = await realpath(tmpdir());
    if (actual.startsWith(`${parent}${sep}`) && resolve(actual) === resolve(directory) &&
        actual.split(sep).at(-1).startsWith("sweet-by-andre-backup-test-"))
      await rm(actual, { recursive: true });
  }
});
