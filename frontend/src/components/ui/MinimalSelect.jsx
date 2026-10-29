import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Minimal accessible dropdown, rendered in a portal so that cards with
 * overflow-hidden (and nested scroll areas) cannot crop the options.
 *
 * Compatible with the existing API: label, value, options, onChange, disabled.
 */
export default function MinimalSelect({
  label,
  value,
  options = [],
  onChange,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const rootRef = useRef(null);
  const menuId = useId();

  const enabled = options.filter((option) => !option.disabled);
  const selected = options.find((option) => option.value === value);

  function openMenu() {
    if (disabled) return;
    setActiveIndex(Math.max(0, enabled.findIndex((option) => option.value === value)));
    setOpen(true);
  }

  function closeMenu({ restoreFocus = false } = {}) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function selectOption(option) {
    if (!option || option.disabled) return;
    onChange(option.value);
    closeMenu({ restoreFocus: true });
  }

  // Calculate the popover's position relative to the viewport. Using a portal
  // is necessary because the admin forms use overflow-hidden for rounded cards.
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }

    function updatePlacement() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const gap = 6;
      const below = viewportHeight - rect.bottom - gap - 8;
      const above = rect.top - gap - 8;
      const displayAbove = below < 190 && above > below;
      const available = displayAbove ? above : below;
      const maxHeight = Math.max(80, Math.min(256, available));
      const width = Math.min(rect.width, Math.max(120, viewportWidth - 16));
      const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
      const top = displayAbove
        ? Math.max(8, rect.top - gap - maxHeight)
        : Math.max(8, rect.bottom + gap);

      setPlacement({ top, left, width, maxHeight });
    }

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(event) {
      if (
        !rootRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        closeMenu();
      }
    }
    document.addEventListener("pointerdown", handleOutsideClick, true);
    return () => document.removeEventListener("pointerdown", handleOutsideClick, true);
  }, [open]);

  useEffect(() => {
    if (!open || !placement) return;
    const items = menuRef.current?.querySelectorAll('[role="option"]');
    items?.[activeIndex]?.focus({ preventScroll: true });
  }, [open, activeIndex, placement]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    }
    if (event.key === "Tab") {
      // Return focus to the trigger so tab order continues inside the form.
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!enabled.length) return;
      if (!open) {
        openMenu();
        return;
      }
      if (event.key === "Home") setActiveIndex(0);
      else if (event.key === "End") setActiveIndex(enabled.length - 1);
      else {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => (current + step + enabled.length) % enabled.length);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) openMenu();
      else selectOption(enabled[activeIndex]);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
        className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3 text-left text-sm text-[#282323] shadow-sm transition-colors hover:border-[#C9939E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B76473] disabled:cursor-not-allowed disabled:opacity-50 ${open ? "border-[#B76473] ring-2 ring-[#B76473]/10" : "border-[#E7DCD9]"}`}
      >
        <span className="truncate">{selected?.label ?? "Select an option"}</span>
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className={`shrink-0 text-[#B76473] transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && placement && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="listbox"
          aria-label={label}
          style={{
            position: "fixed",
            zIndex: 9999,
            top: placement.top,
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
          }}
          onKeyDown={handleKeyDown}
          className="overflow-y-auto rounded-xl border border-[#E7DCD9] bg-white p-1.5 shadow-xl"
        >
          {enabled.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={index === activeIndex ? 0 : -1}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(option)}
              className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#B76473] ${option.value === value ? "bg-[#FAF0F1] font-semibold text-[#9C4D60]" : "text-[#282323] hover:bg-[#FAF7F5]"}`}
            >
              <span>{option.label}</span>
              {option.value === value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          {enabled.length === 0 && (
            <p className="px-3 py-2 text-sm text-[#756B69]">No options available</p>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
