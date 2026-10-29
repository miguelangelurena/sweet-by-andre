import { useEffect, useState } from "react";
import { apiRequest, getProducts } from "../../services/api";
import ProductCard from "./ProductCard";

const decorations = { valentines: "♡", thanksgiving: "✦", christmas: "✧" };

export default function SeasonalCollections({ compact = false }) {
  const [collections, setCollections] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([apiRequest("/seasonal"), getProducts()]).then(([seasons, catalog]) => {
      if (!active) return;
      setCollections(seasons.collections ?? []);
      setProducts(catalog.products ?? []);
    }).catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  if (error) return compact ? null : <p role="alert" className="py-10 text-center text-red-700">Could not load seasonal collections. {error}</p>;
  if (!loading && collections.length === 0) return compact ? null : <p className="py-12 text-center text-sm text-[#756B69]">Seasonal treats are coming soon.</p>;
  const byId = new Map(products.map((p) => [p.id, p]));
  return (
    <section id="seasonal" className="bg-[#FFF9F8] px-6 py-20" aria-label="Seasonal collections">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#B76473]">For every celebration</p>
          <h2 className="mt-3 font-serif text-4xl text-[#282323]">Seasonal sweets</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#796D6A]">Handcrafted collections for your favorite moments.</p>
        </div>
        {loading ? <div aria-label="Loading seasonal collections" role="status" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{[1,2,3].map((i) => <div key={i} className="sba-skeleton h-44 rounded-2xl" />)}</div>
          : <div className="space-y-14">{collections.map((season) => {
            const available = (season.product_ids ?? []).map(id => byId.get(id)).filter(p => p?.is_available);
            if (compact && !available.length) return null;
            return (
              <div key={season.slug}>
                <header className="mb-6 flex flex-wrap items-center gap-4 border-b border-[#E7DCD9] pb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FAEBEE] text-3xl text-[#B76473]" aria-hidden="true">{decorations[season.slug] ?? "✧"}</div>
                  <div><h3 className="font-serif text-2xl text-[#282323]">{season.title}</h3><p className="mt-1 text-sm text-[#796D6A]">{season.description}</p></div>
                </header>
                {available.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{available.slice(0, compact ? 3 : undefined).map(product => <ProductCard product={product} key={product.id} />)}</div>
                  : <p className="text-sm text-[#756B69]">No desserts available for this collection just yet.</p>}
                {compact && available.length > 3 && <a href="#seasonal" className="mt-5 inline-block font-semibold text-[#B76473] underline">See all seasonal treats</a>}
              </div>
            );
          })}</div>}
      </div>
    </section>
  );
}
