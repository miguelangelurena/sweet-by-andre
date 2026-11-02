import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export default function ConfirmDialog({
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  destructive = false,
  onConfirm,
  onCancel,
}) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  function handleKeys(event) {
    // The order details behind this native dialog have their own keyboard
    // handler. Keep Escape and focus navigation within this confirmation.
    event.stopPropagation();
    if (event.key !== "Tab") return;
    const controls = [
      ...dialogRef.current.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
      ),
    ];
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onKeyDown={handleKeys}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-3xl border border-[#E7DCD9] bg-white p-0 text-[#282323] shadow-2xl backdrop:bg-[#282323]/55"
    >
      <div className="p-5 sm:p-7">
        <div
          aria-hidden="true"
          className={`mb-4 grid h-11 w-11 place-items-center rounded-full ${destructive ? "bg-red-50 text-red-700" : "bg-[#FAF0F1] text-[#B76473]"}`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <path d={destructive ? "M6 6l12 12M18 6 6 18" : "m5 12 4 4L19 6"} />
          </svg>
        </div>
        <h2 id={titleId} className="font-serif text-2xl">
          {title}
        </h2>
        <p id={descriptionId} className="mt-3 text-sm leading-6 text-[#796D6A]">
          {description}
        </p>
        {children}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-full border border-[#E7DCD9] px-4 py-3 text-sm font-semibold text-[#796D6A] hover:bg-[#FAF7F5] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`min-h-11 flex-1 rounded-full px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 ${destructive ? "bg-red-700 hover:bg-red-800" : "bg-[#B76473] hover:bg-[#A65363]"}`}
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
