import { useEffect, useId, useRef, useState } from "react";

/** Accessible, lightweight listbox for product variant choices. */
export default function MinimalSelect({ label, value, options, onChange, disabled=false }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const trigger = useRef(null);
  const list = useRef(null);
  const root = useRef(null);
  const uid = useId();
  const enabled = options.filter(o => !o.disabled);
  const selected = options.find(o=>o.value===value);
  useEffect(() => {
    if (!open) return;
    const closeOutside = e => { if (root.current && !root.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  function openMenu() {
    if (disabled) return;
    setActiveIndex(Math.max(0, enabled.findIndex(o=>o.value===value)));
    setOpen(true);
  }
  useEffect(() => {
    if (!open) return;
    const items = list.current?.querySelectorAll('[role="option"]');
    items?.[activeIndex]?.focus();
  }, [open, activeIndex]);
  function pick(option) {
    if (!option || option.disabled) return;
    onChange(option.value); setOpen(false); trigger.current?.focus();
  }
  function onKey(event) {
    if (event.key==="Escape" || event.key==="Tab") { setOpen(false); if(event.key==="Escape") { event.preventDefault(); trigger.current?.focus(); } return; }
    if (["ArrowDown","ArrowUp","Home","End"].includes(event.key)) {
      event.preventDefault();
      if (!enabled.length) return;
      if (!open) { openMenu(); return; }
      if(event.key==="Home") setActiveIndex(0);
      else if(event.key==="End") setActiveIndex(Math.max(0,enabled.length-1));
      else setActiveIndex(i => (i + (event.key==="ArrowDown"?1:-1) + enabled.length)%enabled.length);
      return;
    }
    if (event.key==="Enter" || event.key===" ") { event.preventDefault(); if(open) pick(enabled[activeIndex]); else openMenu(); }
  }
  return <div ref={root} className="relative">
    <button type="button" ref={trigger} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? uid : undefined}
      onClick={()=>open ? setOpen(false) : openMenu()} onKeyDown={onKey} disabled={disabled}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3.5 text-left text-sm text-[#282323] shadow-sm transition-colors hover:border-[#C9939E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B76473] ${open ? "border-[#B76473] ring-2 ring-[#B76473]/10" : "border-[#E7DCD9]"} disabled:cursor-not-allowed disabled:opacity-50`}>
      <span>{selected?.label ?? "Select an option"}</span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`shrink-0 text-[#B76473] transition-transform ${open?"rotate-180":""}`}><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
    {open && <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-[#E7DCD9] bg-white p-1.5 shadow-xl">
      <div id={uid} ref={list} role="listbox" aria-label={label} className="max-h-56 overflow-y-auto" onKeyDown={onKey}>
        {enabled.map((option,index)=><button key={option.value} type="button" role="option" aria-selected={option.value===value} tabIndex={index===activeIndex?0:-1}
          onMouseEnter={()=>setActiveIndex(index)} onClick={()=>pick(option)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm ${option.value===value?"bg-[#FAF0F1] font-semibold text-[#9C4D60]":"text-[#282323] hover:bg-[#FAF7F5]"}`}>
          {option.label}{option.value===value?<span aria-hidden="true">✓</span>:null}</button>)}
        {enabled.length===0 && <p className="px-3 py-2 text-sm text-[#756B69]">No options available</p>}
      </div>
    </div>}
  </div>;
}
