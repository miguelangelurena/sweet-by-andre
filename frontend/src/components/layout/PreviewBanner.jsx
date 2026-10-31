export default function PreviewBanner() {
  if (import.meta.env.VITE_APP_ENV !== "staging") return null;
  return (
    <div
      role="note"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs leading-5 text-amber-900"
    >
      Preview environment · Changes here are for testing. Online payments are
      disabled.
    </div>
  );
}
