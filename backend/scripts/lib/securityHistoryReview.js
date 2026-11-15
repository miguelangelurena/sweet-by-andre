// Only a documented revocation of an exact immutable historical blob may be
// acknowledged. Current files and other kinds of findings never qualify.
export function isReviewedRevocation(finding, entries) {
  return (
    finding.history === true &&
    finding.type === "Database password in environment file" &&
    /^[a-f0-9]{40}$/.test(finding.blob || "") &&
    entries.some(
      (entry) =>
        entry.path === finding.path &&
        entry.blob === finding.blob &&
        entry.type === finding.type &&
        entry.status === "revoked" &&
        /^\d{4}-\d{2}-\d{2}$/.test(entry.verifiedAt || ""),
    )
  );
}
