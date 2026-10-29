import { useEffect, useMemo, useState } from "react";
import { getProducts } from "../../services/api";
import { ProductGridSkeleton } from "../ui/Skeleton";

export default function ProductCatalog() {
  const [products, setProducts] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(8);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadProducts() {
      try {
        const response = await getProducts();

        if (active) {
          setProducts(response.products ?? []);
          setError("");
        }
      } catch (err) {
        if (active) {
          setError(err.message || "Unable to load products.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadProducts();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => { setVisibleCount(8); }, [selectedCategory]);

  const categories = useMemo(() => {
    const unique = new Map();

    products.forEach((product) => {
      if (product.category_id) {
        unique.set(product.category_id, product.category_name);
      }
    });

    return Array.from(unique, ([id, name]) => ({ id, name }));
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (selectedCategory === "all") return products;

    return products.filter(
      (product) => product.category_id === selectedCategory,
    );
  }, [products, selectedCategory]);

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#B76473]">
          Made with love
        </p>

        <h1 className="mt-3 font-serif text-3xl text-[#282323] sm:text-4xl lg:text-5xl">
          Our Sweet Collection
        </h1>

        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[#756B69] sm:text-base">
          Explore our selection of handcrafted desserts, made to make every
          occasion a little sweeter.
        </p>
      </div>

      {!loading && !error && products.length > 0 && (
        <div className="mb-8 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedCategory("all")}
            aria-pressed={selectedCategory === "all"}
            className={`rounded-full px-5 py-2.5 text-sm font-medium transition-colors ${
              selectedCategory === "all"
                ? "bg-[#B76473] text-white"
                : "border border-[#E7DCD9] bg-white text-[#756B69] hover:bg-[#FAF0F1]"
            }`}
          >
            All Products
          </button>

          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setSelectedCategory(category.id)}
              aria-pressed={selectedCategory === category.id}
              className={`rounded-full px-5 py-2.5 text-sm font-medium transition-colors ${
                selectedCategory === category.id
                  ? "bg-[#B76473] text-white"
                  : "border border-[#E7DCD9] bg-white text-[#756B69] hover:bg-[#FAF0F1]"
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <ProductGridSkeleton count={8} className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" />
      )}

      {!loading && error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-5 text-center text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {!loading && !error && products.length === 0 && (
        <p className="py-16 text-center text-[#756B69]">
          Our collection is coming soon. Stay tuned!
        </p>
      )}

      {!loading && !error && filteredProducts.length > 0 && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredProducts.slice(0, visibleCount).map((product) => {
            const outOfStock = Number(product.stock) <= 0;

            return (
              <article
                key={product.id}
                className="group overflow-hidden rounded-2xl border border-[#E7DCD9] bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-[#FAF0F1]">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-[#B76473]">
                      Photo coming soon
                    </div>
                  )}

                  {outOfStock && (
                    <span className="absolute right-3 top-3 rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#756B69] shadow-sm">
                      Sold Out
                    </span>
                  )}
                </div>

                <div className="p-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-[#B76473]">
                    {product.category_name}
                  </p>

                  <h2 className="mt-2 font-serif text-xl text-[#282323]">
                    {product.name}
                  </h2>

                  {product.description && (
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#756B69]">
                      {product.description}
                    </p>
                  )}

                  <div className="mt-5 flex items-center justify-between gap-3">
                    <span className="text-lg font-semibold text-[#282323]">
                      ${Number(product.price).toFixed(2)}
                    </span>

                    <span
                      className={`text-xs font-medium ${
                        outOfStock ? "text-[#756B69]" : "text-green-700"
                      }`}
                    >
                      {outOfStock ? "Unavailable" : "Available"}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!loading && !error && filteredProducts.length > visibleCount && (
        <div className="mt-10 text-center">
          <button type="button" onClick={() => setVisibleCount((count) => count + 8)}
            className="rounded-full border border-[#B76473] bg-white px-8 py-3 font-semibold text-[#97495A] transition-colors hover:bg-[#FAEDEE]">
            Show more products
          </button>
          <p className="mt-3 text-sm text-[#756B69]" aria-live="polite">
            Showing {Math.min(visibleCount, filteredProducts.length)} of {filteredProducts.length} products
          </p>
        </div>
      )}

      {!loading &&
        !error &&
        products.length > 0 &&
        filteredProducts.length === 0 && (
          <p className="py-12 text-center text-[#756B69]">
            No products found in this category.
          </p>
        )}
    </section>
  );
}
