import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isReviewedRevocation } from "./lib/securityHistoryReview.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const git = (args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
const files = [
  ...new Set([
    ...tracked,
    ...git(["ls-files", "--others", "--exclude-standard", "-z"])
      .split("\0")
      .filter(Boolean),
  ]),
];
const findings = [];
const reviewedHistory = [];
let reviews = [];
try {
  reviews = JSON.parse(
    readFileSync(
      new URL("../../security-reviewed-history.json", import.meta.url),
      "utf8",
    ),
  ).entries;
  if (!Array.isArray(reviews))
    throw new Error("Invalid historical revocation record");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const patterns = [
  ["Stripe secret key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g],
  ["Stripe signing secret", /\bwhsec_[A-Za-z0-9]{24,}\b/g],
  ["AWS access identifier", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["Brevo API key", /\bxkeysib-[A-Za-z0-9-]{40,}\b/g],
  [
    "GitHub token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g,
  ],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
const textFile = (path) =>
  /\.(?:[cm]?js|jsx|json|md|ya?ml|sql|txt|csv)$|(?:^|\/)\.env(?:\.|$)/i.test(
    path,
  );
const excluded = (path) => /(?:^|\/)(?:node_modules|dist)\//.test(path);
function scan(text, path, history = false, blob) {
  if (/(?:^|\/)\.env(?:\.|$)/i.test(path)) {
    for (const match of text.matchAll(
      /^[ \t]*DB_PASSWORD[ \t]*=[ \t]*([^\r\n]*)/gm,
    )) {
      const value = match[1].trim().replace(/^(['"])(.*)\1$/, "$2");
      if (
        value &&
        !/^(?:change[_ -]?me|replace[_ -]?me|your[_ -].*|<[^>]+>)$/i.test(value)
      ) {
        const finding = {
          type: "Database password in environment file",
          path,
          line: text.slice(0, match.index).split("\n").length,
          history,
          ...(history ? { blob } : {}),
        };
        if (isReviewedRevocation(finding, reviews))
          reviewedHistory.push({ ...finding, status: "revoked" });
        else findings.push(finding);
      }
    }
  }
  for (const [type, pattern] of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      // Explicit historical numeric fixture; do not exempt real test-mode keys.
      if (
        history &&
        path === "backend/.env.test" &&
        match[0] === "sk_test_" + "123456789012345678901234"
      )
        continue;
      findings.push({
        type,
        path,
        line: text.slice(0, match.index).split("\n").length,
        history,
      });
    }
  }
  if (/cookies[^/]*\.txt$/i.test(path)) {
    const hasCookie = text
      .split(/\r?\n/)
      .some(
        (line) =>
          line &&
          (!line.startsWith("#") || line.startsWith("#HttpOnly_")) &&
          (line.split("\t").length === 7 ||
            /connect\.sid|sweetbyandre_guest_cart|authorization\s*:/i.test(
              line,
            )),
      );
    if (hasCookie)
      findings.push({ type: "Cookie/session material", path, history });
  }
}
for (const path of tracked) {
  if (
    excluded(path) ||
    (/(?:^|\/)\.env(?:\..*)?$/.test(path) && !path.endsWith(".example")) ||
    /cookies[^/]*\.txt$|\.(?:pem|key|dump)$/i.test(path)
  )
    findings.push({ type: "Sensitive/generated file tracked", path });
}
let scanned = 0,
  historyBlobs = 0;
for (const path of files) {
  if (excluded(path) || !textFile(path)) continue;
  try {
    scan(
      readFileSync(new URL(path, new URL("../../", import.meta.url)), "utf8"),
      path,
    );
    scanned++;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
if (process.argv.includes("--history")) {
  const seen = new Set();
  for (const line of git(["rev-list", "--objects", "--all"]).split("\n")) {
    const split = line.indexOf(" ");
    if (split < 0) continue;
    const sha = line.slice(0, split),
      path = line.slice(split + 1);
    if (seen.has(sha) || excluded(path) || !textFile(path)) continue;
    seen.add(sha);
    if (git(["cat-file", "-t", sha]).trim() !== "blob") continue;
    scan(git(["cat-file", "blob", sha]), path, true, sha);
    historyBlobs++;
  }
}
console.log(
  JSON.stringify(
    { scannedFiles: scanned, historyBlobs, findings, reviewedHistory },
    null,
    2,
  ),
);
// A supplementary pattern check, not a comprehensive secret scanner. Never
// print matched values; historical exposure requires separate rotation review.
if (findings.length) process.exitCode = 1;
