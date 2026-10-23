import { useEffect, useState } from "react";
import { getProducts, getCategories } from "../services/api";
import ProductCard from "../components/products/ProductCard";

export default function Catalog() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [loading, setLoading] = useState(true);
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

  return (
    <main className="min-h-screen bg-[#FAF7F5] px-6 py-16">
      <div className="mx-auto max-w-7xl">
        <header className="mb-12 text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-[#B76473]">
            Handcrafted with love
          </span>

          <h1 className="mt-4 font-serif text-5xl text-[#282323]">
            Explore Our Menu
          </h1>

          <p className="mx-auto mt-5 max-w-xl leading-7 text-[#796D6A]">
            Discover our handcrafted desserts, made for your sweetest moments.
          </p>
        </header>

        {loading && (
          <p className="text-center text-[#796D6A]">
            Loading our sweet creations...
          </p>
        )}

        {error && (
          <p role="alert" className="text-center text-red-700">
            We couldn't load the menu: {error}
          </p>
        )}

        {!loading && !error && (
          <>
            <div className="mb-12 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => setSelectedCategory("all")}
                className={`rounded-full px-6 py-3 text-sm transition ${
                  selectedCategory === "all"
                    ? "bg-[#B76473] text-white"
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
                  className={`rounded-full px-6 py-3 text-sm transition ${
                    selectedCategory === category.id
                      ? "bg-[#B76473] text-white"
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
              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {visibleProducts.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
