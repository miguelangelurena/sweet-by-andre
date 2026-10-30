import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const envText = readFileSync(envPath, "utf8");
const config = { ...dotenv.parse(envText), ...process.env };
if (!config.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
  throw new Error("Local forwarding requires a Stripe test secret key");
}
// All CLI arguments below are fixed strings; credentials are passed via env.
const command = (args) => process.platform === "win32"
  ? [`stripe.cmd ${args.join(" ")}`, []]
  : ["stripe", args];
const options = {
  env: { ...config, STRIPE_API_KEY: config.STRIPE_SECRET_KEY },
  shell: process.platform === "win32",
  windowsHide: true,
};
const redact = (value) => String(value).replace(/(?:whsec_|sk_test_|sk_live_)\S+/g, "[redacted]");
const [secretCommand, secretArgs] = command(["listen", "--print-secret", "--skip-update"]);
const result = spawnSync(secretCommand, secretArgs, {
  ...options, encoding: "utf8", timeout: 20000,
});
const secret = result.stdout?.trim();
if (result.status !== 0 || !/^whsec_[A-Za-z0-9]+$/.test(secret ?? "")) {
  console.error(redact(result.error?.message || result.stderr || result.stdout || "Could not start Stripe CLI. Install the official Stripe CLI first."));
  process.exit(1);
}
// Change only the local signing secret, preserving all other settings.
const currentText = readFileSync(envPath, "utf8");
const line = `STRIPE_WEBHOOK_SECRET=${secret}`;
const updated = /^STRIPE_WEBHOOK_SECRET\s*=.*$/m.test(currentText)
  ? currentText.replace(/^STRIPE_WEBHOOK_SECRET\s*=.*$/m, line)
  : `${currentText.trimEnd()}\n${line}\n`;
if (updated !== currentText) {
  writeFileSync(envPath, updated);
  console.log("Local webhook signing secret updated in backend/.env. Restart the backend to load it.");
}
const [listenCommand, listenArgs] = command([
  "listen", "--skip-update", "--events", "checkout.session.completed,checkout.session.expired",
  "--forward-to", "http://localhost:5000/api/payments/webhook",
]);
const listener = spawn(listenCommand, listenArgs, { ...options, stdio: ["ignore", "pipe", "pipe"] });
listener.stdout.on("data", (chunk) => process.stdout.write(redact(chunk)));
listener.stderr.on("data", (chunk) => process.stderr.write(redact(chunk)));
listener.on("error", (error) => { console.error(redact(error.message)); process.exitCode = 1; });
listener.on("exit", (code) => { process.exitCode = code ?? 1; });
process.on("SIGINT", () => listener.kill("SIGINT"));
process.on("SIGTERM", () => listener.kill("SIGTERM"));
