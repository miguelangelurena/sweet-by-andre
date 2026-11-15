export function securityError(
  error,
  context = "Application operation failed",
  requestId,
) {
  const code =
    typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code)
      ? error.code
      : "INTERNAL_ERROR";
  // Deliberately exclude messages, stacks, SQL details, request bodies and
  // provider responses, which can contain customer data or credentials.
  console.error(context, { code, ...(requestId ? { requestId } : {}) });
}
