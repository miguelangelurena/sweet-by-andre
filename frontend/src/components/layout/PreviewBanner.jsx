export default function PreviewBanner() {
  if (import.meta.env.VITE_APP_ENV !== "staging") return null;
  const testPaymentsEnabled = import.meta.env.VITE_ENABLE_STRIPE_CHECKOUT === "true";
  return (
    <div
      role="note"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs leading-5 text-amber-900"
    >
      Preview environment · Changes here are for testing.{" "}
      {testPaymentsEnabled
        ? "Stripe test payments only. Do not enter real card details."
        : "Online payments are disabled."}
    </div>
  );
}
