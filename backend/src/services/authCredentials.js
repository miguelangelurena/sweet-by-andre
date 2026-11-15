import { createHash } from "node:crypto";

// Session metadata stays on the server. A password change invalidates the
// previous version even if an in-flight request saves an old session again.
export function credentialVersion(passwordHash) {
  return typeof passwordHash === "string" && passwordHash.length > 0
    ? createHash("sha256").update(passwordHash).digest("hex") : null;
}

export function validAuthenticatedSession(session, passwordHash, now = Date.now()) {
  const version = credentialVersion(passwordHash);
  return Boolean(version && session.credentialVersion === version &&
    Number.isSafeInteger(session.authenticatedAt) && Number.isSafeInteger(session.lastSeenAt) &&
    session.authenticatedAt <= now && session.lastSeenAt <= now &&
    now - session.authenticatedAt < 8 * 60 * 60 * 1000 &&
    now - session.lastSeenAt < 30 * 60 * 1000);
}
