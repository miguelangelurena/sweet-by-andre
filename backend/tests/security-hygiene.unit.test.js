import test from "node:test";
import assert from "node:assert/strict";
import { isReviewedRevocation } from "../scripts/lib/securityHistoryReview.js";

const finding = {
  history: true,
  path: "backend/.env.test",
  blob: "a".repeat(40),
  type: "Database password in environment file",
};
const entry = { ...finding, status: "revoked", verifiedAt: "2026-11-15" };

test("revocation evidence acknowledges only the exact historical blob and finding", () => {
  assert.equal(isReviewedRevocation(finding, [entry]), true);
  for (const change of [
    { history: false },
    { blob: "b".repeat(40) },
    { path: "backend/.env" },
    { type: "Stripe secret key" },
    { blob: undefined },
  ])
    assert.equal(
      isReviewedRevocation({ ...finding, ...change }, [entry]),
      false,
    );
});

test("missing or unverified revocation evidence cannot suppress a finding", () => {
  assert.equal(isReviewedRevocation(finding, []), false);
  for (const change of [
    { status: "pending" },
    { verifiedAt: undefined },
    { verifiedAt: "not-a-date" },
    { blob: "b".repeat(40) },
  ])
    assert.equal(
      isReviewedRevocation(finding, [{ ...entry, ...change }]),
      false,
    );
});
