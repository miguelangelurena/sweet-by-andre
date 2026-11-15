import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import request from "supertest";
import bcrypt from "bcrypt";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";
import { requireTestDatabase } from "./helpers/requireTestDatabase.js";
import { inspectAdminRecovery, resetAdminPassword } from "../src/services/adminAccessRecovery.service.js";
import { createRecoveryTerminal } from "../scripts/lib/recoveryTerminal.js";

after(() => pool.end());

test("password terminal suppresses secret echo and rejects redirected input", async () => {
  const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
  let captured = "";
  const output = new Writable({ write(chunk, _encoding, done) { captured += chunk.toString(); done(); } });
  output.isTTY = true; output.columns = 80;
  const terminal = createRecoveryTerminal({ input, output });
  try {
    const question = terminal.hidden("Hidden password: ");
    input.write("SyntheticSecretForTest123!\r");
    assert.equal(await question, "SyntheticSecretForTest123!");
    assert.ok(captured.includes("Hidden password:"));
    assert.equal(captured.includes("SyntheticSecretForTest123!"), false);
  } finally { terminal.close(); input.end(); }
  assert.throws(() => createRecoveryTerminal({ input: { isTTY: false }, output }), /interactive/);
  const child = spawnSync(process.execPath, ["scripts/resetAdminPassword.js"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), env: process.env,
    encoding: "utf8", timeout: 5000, windowsHide: true,
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /interactive terminal/);
});

test("manual recovery changes only the confirmed administrator and invalidates old sessions", { timeout: 30000 }, async t => {
  await requireTestDatabase(pool);
  const ids = [];
  const env = { APP_ENV: "test", NODE_ENV: "test" };
  const options = { database: pool, env };
  const oldPassword = "RecoveryOriginalPassword123!";
  const newPassword = "RecoveryReplacementPassword123!";
  const admin = request.agent(app), secondSession = request.agent(app), other = request.agent(app);
  async function fixture(role, deleted = false) {
    const email = `recovery-${randomUUID()}@example.com`;
    const user = (await pool.query(`INSERT INTO users (first_name,last_name,email,phone,password_hash,role,deleted_at)
      VALUES ('Recovery','Fixture',$1,'5551234567',$2,$3,$4) RETURNING id,email`,
      [email, await bcrypt.hash(oldPassword, 4), role, deleted ? new Date() : null])).rows[0];
    ids.push(user.id); return user;
  }
  try {
    const target = await fixture("admin"), unrelated = await fixture("admin"), customer = await fixture("customer"), disabled = await fixture("admin", true);
    await admin.post("/api/auth/login").send({ email: target.email, password: oldPassword }).expect(200);
    await secondSession.post("/api/auth/login").send({ email: target.email, password: oldPassword }).expect(200);
    await other.post("/api/auth/login").send({ email: unrelated.email, password: oldPassword }).expect(200);
    const plan = await inspectAdminRecovery(` ${target.email.toUpperCase()} `, options);
    const oldToken = (await admin.get("/api/cart/csrf-token").expect(200)).body.csrf_token;
    const storedSessions = (await pool.query("SELECT * FROM session WHERE sess->>'userId'=$1", [target.id])).rows;
    const originalHash = (await pool.query("SELECT password_hash FROM users WHERE id=$1", [target.id])).rows[0].password_hash;
    await t.test("missing, customer, disabled and wrong-environment targets are rejected", async () => {
      for (const email of [customer.email, disabled.email, "missing@example.com"])
        await assert.rejects(inspectAdminRecovery(email, options), /active administrator/);
      await assert.rejects(inspectAdminRecovery(target.email, { ...options, env: { APP_ENV: "staging" } }), /refuses local/);
      await assert.rejects(resetAdminPassword({ ...plan, database: "another_database" }, newPassword, options), /target changed/);
      await assert.rejects(resetAdminPassword({ ...plan, userId: customer.id, email: customer.email }, newPassword, options), /credentials or access changed/);
    });
    await t.test("invalid and reused passwords make no change", async () => {
      for (const password of ["short", "é".repeat(37)])
        await assert.rejects(resetAdminPassword(plan, password, options), /at least 16/);
      await assert.rejects(resetAdminPassword(plan, oldPassword, options), /different/);
      assert.equal((await pool.query("SELECT password_hash FROM users WHERE id=$1", [target.id])).rows[0].password_hash, originalHash);
      await admin.get("/api/admin/products").expect(200);
    });
    await t.test("password update rolls back if session removal fails", async () => {
      const failingDatabase = { async connect() {
        const client = await pool.connect();
        return { connectionParameters: client.connectionParameters, release: () => client.release(),
          query(sql, values) { if (/^DELETE FROM public.session/.test(sql)) throw new Error("simulated session storage failure"); return client.query(sql, values); } };
      } };
      await assert.rejects(resetAdminPassword(plan, newPassword, { ...options, database: failingDatabase }), /simulated/);
      assert.equal((await pool.query("SELECT password_hash FROM users WHERE id=$1", [target.id])).rows[0].password_hash, originalHash);
      await admin.get("/api/admin/products").expect(200);
    });
    const result = await resetAdminPassword(plan, newPassword, options);
    assert.equal(result.sessionsRemoved, 2);
    await admin.get("/api/auth/me").expect(401);
    await secondSession.get("/api/admin/products").expect(401);
    await other.get("/api/admin/products").expect(200);
    await request(app).post("/api/auth/login").send({ email: target.email, password: oldPassword }).expect(401);
    await t.test("a stale session saved after reset cannot regain access or authenticated checkout", async () => {
      for (const row of storedSessions)
        await pool.query("INSERT INTO session (sid,sess,expire) VALUES ($1,$2,$3)", [row.sid, row.sess, row.expire]);
      await admin.get("/api/admin/products").expect(401);
      await admin.post("/api/payments/checkout").set("X-CSRF-Token", oldToken).send({ order_id: randomUUID() }).expect(401);
      for (const row of storedSessions) {
        const legacy = { ...row.sess }; delete legacy.credentialVersion;
        await pool.query("UPDATE session SET sess=$2 WHERE sid=$1", [row.sid, legacy]);
      }
      await secondSession.get("/api/auth/me").expect(401);
    });
    await admin.post("/api/auth/login").send({ email: target.email, password: newPassword }).expect(200);
    const me = (await admin.get("/api/auth/me").expect(200)).body.user;
    assert.equal(me.password_hash, undefined); assert.equal(me.credentialVersion, undefined);
    await t.test("concurrent recovery plans cannot silently overwrite each other", async () => {
      const reviewed = await inspectAdminRecovery(target.email, options);
      const results = await Promise.allSettled([
        resetAdminPassword(reviewed, "ConcurrentRecoveryPasswordOne123!", options),
        resetAdminPassword(reviewed, "ConcurrentRecoveryPasswordTwo123!", options),
      ]);
      assert.equal(results.filter(entry => entry.status === "fulfilled").length, 1);
      assert.equal(results.filter(entry => entry.status === "rejected").length, 1);
      await assert.rejects(resetAdminPassword(plan, "OutdatedRecoveryPassword123!", options), /credentials or access changed/);
    });
    await other.get("/api/admin/products").expect(200);
  } finally {
    await pool.query("DELETE FROM session WHERE sess->>'userId'=ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  }
});
