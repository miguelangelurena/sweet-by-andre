import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { env, execPath } from "node:process";
import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

test("hosted builds separate production from staging and reject production payments", { timeout: 60000 }, async () => {
  const output = await mkdtemp(join(tmpdir(), "sweet-by-andre-hosted-build-"));
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
  const build = (appEnv, checkout) => spawnSync(execPath, [vite, "build", "--outDir", output], {
    cwd, env: { ...env, VITE_APP_ENV: appEnv, VITE_ENABLE_STRIPE_CHECKOUT: checkout },
    encoding: "utf8", timeout: 25000, windowsHide: true,
  });
  const scripts = async () => {
    const names = (await readdir(join(output, "assets"))).filter(name => name.endsWith(".js"));
    return (await Promise.all(names.map(name => readFile(join(output, "assets", name), "utf8")))).join("\n");
  };
  try {
    const blocked = build("production", "true");
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /Production checkout remains disabled/);
    const production = build("production", "false");
    assert.equal(production.status, 0, production.stderr);
    assert.equal((await scripts()).includes("Preview environment"), false);
    // Reuse only this test's own temporary output folder.
    const staging = build("staging", "true");
    assert.equal(staging.status, 0, staging.stderr);
    const stagingScripts = await scripts();
    assert.equal(stagingScripts.includes("Preview environment"), true);
    assert.equal(stagingScripts.includes("Stripe test payments only."), true);
  } finally {
    const actual = await realpath(output), parent = await realpath(tmpdir());
    if (actual.startsWith(`${parent}${sep}`) && resolve(actual) === resolve(output) &&
        actual.split(sep).at(-1).startsWith("sweet-by-andre-hosted-build-"))
      await rm(actual, { recursive: true });
  }
});
