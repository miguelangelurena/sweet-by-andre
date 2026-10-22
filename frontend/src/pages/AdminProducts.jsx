import { useEffect, useState } from "react";
import { getAdminProducts } from "../services/api";

export default function AdminProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadProducts() {
      try {
        const response = await getAdminProducts();
        setProducts(response.products ?? []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadProducts();
  }, []);

  return (
    <main className="p-6 md:p-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl text-[#282323]">
            Product Management
          </h1>

          <p className="mt-2 text-sm text-[#756B69]">
            Manage your bakery products and inventory.
          </p>
        </div>

        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-lg bg-[#D47783] px-5 py-3 text-sm font-semibold text-white opacity-60"
        >
          + Add Product
        </button>
      </div>

      {loading && <p className="text-[#756B69]">Loading products...</p>}

      {error && (
        <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>
      )}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-xl border border-[#E7DCD9] bg-white">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-[#FAF7F5] text-xs uppercase tracking-wider text-[#756B69]">
              <tr>
                <th className="px-5 py-4">Product</th>
                <th className="px-5 py-4">Category</th>
                <th className="px-5 py-4">Price</th>
                <th className="px-5 py-4">Stock</th>
                <th className="px-5 py-4">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#E7DCD9]">
              {products.map((product) => (
                <tr key={product.id}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-4">
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="h-14 w-14 rounded-lg object-cover"
                          onError={(event) => {
                            event.currentTarget.onerror = null;
                            event.currentTarget.src =
                              "data:image/svg+xml," +
                              encodeURIComponent(
                                `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56">
          <rect width="56" height="56" rx="8" fill="#FAF0F1"/>
          <text x="28" y="30" text-anchor="middle"
            font-size="9" fill="#B76473">No image</text>
        </svg>`,
                              );
                          }}
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#FAF0F1] text-xs text-[#B76473]">
                          No image
                        </div>
                      )}

                      <span className="font-medium text-[#282323]">
                        {product.name}
                      </span>
                    </div>
                  </td>

                  <td className="px-5 py-4 text-sm text-[#756B69]">
                    {product.category_name ?? "Uncategorized"}
                  </td>

                  <td className="px-5 py-4 text-sm font-medium text-[#282323]">
                    ${Number(product.price).toFixed(2)}
                  </td>

                  <td className="px-5 py-4 text-sm text-[#756B69]">
                    {product.stock}
                  </td>

                  <td className="px-5 py-4">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        product.is_available
                          ? "bg-green-50 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {product.is_available ? "Available" : "Unavailable"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {products.length === 0 && (
            <p className="p-8 text-center text-sm text-[#756B69]">
              No products found.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
