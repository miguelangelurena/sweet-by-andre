import { useEffect, useState } from "react";
import { createAdminCategory, getAdminCategories, renameAdminCategory, setAdminCategoryActive } from "../../services/api";

export default function AdminCategories({ onChanged }) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [editingName, setEditingName] = useState("");
  async function load() {
    setLoading(true); setError("");
    try { const result = await getAdminCategories(); setCategories(result.categories ?? []); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (open) load(); }, [open]);
  async function saveNew(event) {
    event.preventDefault(); if (busy || !name.trim()) return;
    setBusy("new"); setError(""); setNotice("");
    try { await createAdminCategory({ name: name.trim() }); setName(""); setNotice("Category added. It is now available when creating or editing a product."); await load(); onChanged?.(); }
    catch(err) { setError(err.message); }
    finally { setBusy(""); }
  }
  async function saveName(cat) {
    if (busy || !editingName.trim()) return;
    setBusy(cat.id); setError(""); setNotice("");
    try { await renameAdminCategory(cat.id, { name: editingName.trim() }); setEditing(null); setNotice("Category renamed."); await load(); onChanged?.(); }
    catch(err) { setError(err.message); }
    finally { setBusy(""); }
  }
  async function toggle(cat) {
    if (busy) return;
    const turningOff = cat.is_active;
    if (turningOff && !window.confirm(`${cat.name} will be hidden from the public menu. ${cat.product_count} linked product(s) will remain saved. Continue?`)) return;
    setBusy(cat.id); setError(""); setNotice("");
    try { await setAdminCategoryActive(cat.id, !cat.is_active); setNotice(turningOff ? `${cat.name} hidden. You can restore it at any time.` : `${cat.name} restored.`); await load(); onChanged?.(); }
    catch(err) { setError(err.message); }
    finally { setBusy(""); }
  }
  return <section className="mb-7 overflow-hidden rounded-2xl border border-[#E7DCD9] bg-white shadow-sm">
    <button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)} className="flex w-full items-center justify-between gap-3 p-5 text-left sm:p-6">
      <span><span className="block font-serif text-2xl">Categories</span><span className="mt-1 block text-sm text-[#756B69]">Add, rename, hide, or restore a bakery category.</span></span>
      <span aria-hidden="true" className="font-semibold text-[#B76473]">{open ? "Hide −" : "Manage +"}</span>
    </button>
    {open && <div className="space-y-5 border-t border-[#E7DCD9] p-5 sm:p-6">
      <p className="rounded-xl bg-[#FAF7F5] p-3 text-xs leading-5 text-[#756B69]">Hiding a category removes its products from the public menu, but preserves products and historical orders. Restore it at any time. We deliberately do not permanently delete categories.</p>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <form onSubmit={saveNew} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm font-semibold">New category
          <input value={name} onChange={e=>setName(e.target.value)} maxLength={100} placeholder="e.g. Flan" required className="mt-2 w-full rounded-xl border border-[#E7DCD9] bg-white px-4 py-3 text-sm" />
        </label>
        <button type="submit" disabled={Boolean(busy) || !name.trim()} className="min-h-11 rounded-xl bg-[#B76473] px-5 py-3 text-sm font-semibold text-white hover:bg-[#9B5361] disabled:opacity-50">{busy==="new" ? "Adding..." : "+ Add category"}</button>
      </form>
      {loading ? <div role="status" aria-label="Loading categories" className="space-y-2">{[1,2,3].map(i=><div key={i} className="sba-skeleton h-16 rounded-xl" />)}</div> :
        categories.length===0 ? <p className="text-sm text-[#756B69]">No categories created yet.</p> :
        <div className="divide-y divide-[#F1E9E6]">{categories.map(cat=><div key={cat.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0 flex-1">
            {editing===cat.id ? <input autoFocus value={editingName} maxLength={100} onChange={e=>setEditingName(e.target.value)} className="w-full max-w-sm rounded-xl border border-[#D47783] px-3 py-2" /> : <p className="font-semibold text-[#282323]">{cat.name}</p>}
            <p className="mt-1 text-xs text-[#756B69]">{cat.product_count} linked products · {cat.is_active ? "Visible" : "Hidden"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editing === cat.id ? <>
              <button type="button" onClick={()=>saveName(cat)} disabled={Boolean(busy) || !editingName.trim()} className="rounded-lg bg-[#B76473] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Save</button>
              <button type="button" onClick={()=>setEditing(null)} className="rounded-lg border border-[#E7DCD9] px-3 py-2 text-sm">Cancel</button>
            </> : <button type="button" disabled={Boolean(busy)} onClick={()=>{setEditing(cat.id); setEditingName(cat.name);}} className="rounded-lg border border-[#E7DCD9] px-3 py-2 text-sm text-[#B76473]">Rename</button>}
            <button type="button" disabled={Boolean(busy)} onClick={()=>toggle(cat)} className="rounded-lg border border-[#E7DCD9] px-3 py-2 text-sm text-[#756B69] disabled:opacity-50">{busy===cat.id ? "Saving..." : cat.is_active ? "Hide" : "Restore"}</button>
          </div>
        </div>)}</div>}
    </div>}
  </section>;
}
