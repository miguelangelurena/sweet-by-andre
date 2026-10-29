import { useEffect, useState } from "react";
import { apiRequest, getAdminProducts } from "../services/api";

const input = "w-full rounded-xl border border-[#E7DCD9] bg-white px-4 py-3 text-sm text-[#282323] focus-visible:outline-[#B76473]";
const themes = { valentines: "Valentine's Day", thanksgiving: "Thanksgiving", christmas: "Christmas" };

export default function AdminSeasonal() {
  const [collections, setCollections] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState("valentines");

  useEffect(() => {
    let alive = true;
    Promise.all([apiRequest("/admin/seasonal"), getAdminProducts()])
      .then(([seasons, catalog]) => {
        if (alive) {
          setCollections(seasons.collections ?? []);
          setProducts(catalog.products ?? []);
        }
      })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  function edit(slug, field, value) {
    setCollections((old) => old.map((item) => item.slug === slug ? { ...item, [field]: value } : item));
    setNotice("");
  }

  function toggleProduct(slug, id) {
    const collection = collections.find((c) => c.slug === slug);
    if (!collection) return;
    const current = collection.product_ids ?? [];
    edit(slug, "product_ids", current.includes(id) ? current.filter((p) => p !== id) : [...current, id]);
  }

  async function save(collection) {
    if (busy) return;
    setBusy(collection.slug);
    setError(""); setNotice("");
    try {
      const csrf = await apiRequest("/cart/csrf-token");
      if (!csrf.csrf_token) throw new Error("No session security token available");
      const result = await apiRequest(`/admin/seasonal/${collection.slug}`, {
        method: "PUT",
        headers: { "X-CSRF-Token": csrf.csrf_token },
        body: JSON.stringify({
          title: collection.title, description: collection.description,
          is_published: collection.is_published, product_ids: collection.product_ids ?? [],
        }),
      });
      setCollections((old) => old.map((item) => item.slug === collection.slug ? result.collection : item));
      setNotice(`${collection.title} saved successfully.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  return (
    <main className="px-4 py-8 text-[#282323] sm:px-8 lg:px-10">
      <header className="mb-8">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#B76473]">Curated collections</p>
        <h1 className="mt-2 font-serif text-3xl sm:text-4xl">Seasonal & holiday specials</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#756B69]">Build special holiday collections from existing products. Publishing a collection does not change prices, apply discounts, or bypass stock rules.</p>
      </header>
      {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-5 rounded-xl bg-green-50 p-4 text-sm text-green-700">{notice}</p>}
      {loading ? <div role="status" aria-label="Loading seasonal collections" className="space-y-4">{[0,1,2].map(i => <div key={i} className="sba-skeleton h-32 rounded-2xl" />)}</div>
        : <div className="space-y-5">{collections.map((collection) => (
          <section key={collection.slug} className="overflow-hidden rounded-2xl border border-[#E7DCD9] bg-white shadow-sm">
            <button type="button" aria-expanded={expanded === collection.slug} onClick={() => setExpanded((previous) => previous === collection.slug ? null : collection.slug)}
              className="flex w-full items-center justify-between gap-3 p-5 text-left sm:p-6">
              <span className="font-serif text-2xl">{themes[collection.slug] ?? collection.title}</span>
              <span className="text-xs font-semibold text-[#B76473]">{collection.is_published ? "Published" : "Hidden"} · {collection.product_ids?.length ?? 0} products · {expanded === collection.slug ? "Hide −" : "Edit +"}</span>
            </button>
            {expanded === collection.slug && <div className="space-y-5 border-t border-[#E7DCD9] p-5 sm:p-6">
              <label className="block text-sm font-semibold">Collection title
                <input maxLength={90} value={collection.title} onChange={(e) => edit(collection.slug, "title", e.target.value)} className={`mt-2 ${input}`} />
              </label>
              <label className="block text-sm font-semibold">Description
                <textarea maxLength={350} rows={2} value={collection.description} onChange={(e) => edit(collection.slug, "description", e.target.value)} className={`mt-2 ${input}`} />
              </label>
              <fieldset className="rounded-xl border border-[#E7DCD9] p-4">
                <legend className="px-2 text-sm font-semibold">Products in this collection</legend>
                {products.length === 0 ? <p className="text-sm text-[#756B69]">Create products first to build this collection.</p> :
                  <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">{products.map((product) => (
                    <label key={product.id} className="flex cursor-pointer items-center gap-3 rounded-xl bg-[#FAF7F5] p-3 text-sm">
                      <input type="checkbox" checked={(collection.product_ids ?? []).includes(product.id)}
                        onChange={() => toggleProduct(collection.slug, product.id)} className="h-4 w-4 accent-[#B76473]" />
                      <span>{product.name}</span>
                    </label>
                  ))}</div>}
              </fieldset>
              <label className="flex items-center gap-3 rounded-xl bg-[#FAF0F1] p-4 text-sm font-semibold">
                <input type="checkbox" checked={collection.is_published} onChange={(e) => edit(collection.slug, "is_published", e.target.checked)}
                  className="h-5 w-5 accent-[#B76473]" /> Publish on storefront
              </label>
              <button type="button" disabled={busy !== null || !collection.title.trim()}
                onClick={() => save(collection)} className="min-h-12 rounded-xl bg-[#B76473] px-7 py-3 text-sm font-semibold text-white hover:bg-[#9E4F60] disabled:cursor-not-allowed disabled:opacity-50">
                {busy === collection.slug ? "Saving..." : "Save collection"}
              </button>
            </div>}
          </section>
        ))}</div>}
    </main>
  );
}
