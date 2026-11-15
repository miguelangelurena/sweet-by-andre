import { createHash } from "node:crypto";

// Session metadata stays on the server. A password change invalidates the
// previous version even if an in-flight request saves an old session again.
export function credentialVersion(passwordHash) {
  return typeof passwordHash === "string" && passwordHash.length > 0
    ? createHash("sha256").update(passwordHash).digest("hex") : null;
}
