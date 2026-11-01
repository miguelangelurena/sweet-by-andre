import { useEffect, useState } from "react";
import { getProducts, getCategories } from "../services/api";
import ProductCard from "../components/products/ProductCard";
import { ProductGridSkeleton } from "../components/ui/Skeleton";

export default function Catalog() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(9);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadCatalog() {
      try {
        const [productsData, categoriesData] = await Promise.all([
          getProducts(),
          getCategories(),
        ]);

        setProducts(productsData.products ?? []);
        setCategories(categoriesData.categories ?? []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadCatalog();
  }, []);

  const visibleProducts = products.filter((product) => {
    const matchesCategory =
      selectedCategory === "all" || product.category_id === selectedCategory;

    return product.is_available && matchesCategory;
  });

  useEffect(() => {
    setVisibleCount(9);
  }, [selectedCategory]);

  return (
    <main className="min-h-screen bg-[#FAF7F5] px-4 py-6 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 sm:mb-12 sm:text-center">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#B76473] sm:text-xs sm:tracking-[0.3em]">
            Handcrafted with love
          </span>

          <h1 className="mt-2 font-serif text-3xl text-[#282323] sm:mt-4 sm:text-5xl">
            Explore Our Menu
          </h1>

          <p className="mt-2 max-w-xl text-sm leading-6 text-[#796D6A] sm:mx-auto sm:mt-5 sm:text-base sm:leading-7">
            Discover our handcrafted desserts, made for your sweetest moments.
          </p>
        </header>

        {loading && (
          <ProductGridSkeleton
            count={6}
            className="grid gap-3 sm:grid-cols-2 sm:gap-8 lg:grid-cols-3"
          />
        )}

        {error && (
          <p role="alert" className="text-center text-red-700">
            We couldn't load the menu: {error}
          </p>
        )}

        {!loading && !error && (
          <>
            <div role="group" aria-label="Filter desserts by category" className="-mx-4 mb-4 flex gap-2 overflow-x-auto overscroll-x-contain px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:mb-10 sm:flex-wrap sm:justify-center sm:gap-3 sm:overflow-visible sm:px-0">
              <button
                type="button"
                onClick={() => setSelectedCategory("all")}
                aria-pressed={selectedCategory === "all"}
                className={`min-h-11 shrink-0 rounded-full border whitespace-nowrap px-4 py-2 text-sm transition sm:px-6 sm:py-3 ${
                  selectedCategory === "all"
                    ? "border-[#B76473] bg-[#B76473] text-white"
                    : "border border-[#E7DCD9] bg-white text-[#796D6A] hover:border-[#B76473]"
                }`}
              >
                All Desserts
              </button>

              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(category.id)}
                  aria-pressed={selectedCategory === category.id}
                  className={`min-h-11 shrink-0 rounded-full border whitespace-nowrap px-4 py-2 text-sm transition sm:px-6 sm:py-3 ${
                    selectedCategory === category.id
                      ? "border-[#B76473] bg-[#B76473] text-white"
                      : "border border-[#E7DCD9] bg-white text-[#796D6A] hover:border-[#B76473]"
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>

            {visibleProducts.length === 0 ? (
              <p className="py-16 text-center text-[#796D6A]">
                No desserts available in this collection yet.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 sm:gap-8 lg:grid-cols-3">
                {visibleProducts.slice(0, visibleCount).map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
            {visibleProducts.length > visibleCount && (
              <div className="mt-10 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((count) => count + 9)}
                  className="rounded-full border border-[#B76473] bg-white px-8 py-3 font-semibold text-[#97495A] transition-colors hover:bg-[#FAEDEE]"
                >
                  Show more desserts
                </button>
                <p className="mt-3 text-sm text-[#796D6A]" aria-live="polite">
                  Showing {Math.min(visibleCount, visibleProducts.length)} of{" "}
                  {visibleProducts.length} desserts
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
