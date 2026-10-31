import { useEffect, useRef, useState } from "react";
import { getAdminProducts, updateProductAvailability } from "../services/api";

import AdminProductForm from "../components/admin/AdminProductForm";
import AdminProductEdit from "../components/admin/AdminProductEdit";
import AdminProductGallery from "../components/admin/AdminProductGallery";
import AdminCategories from "../components/admin/AdminCategories";

export default function AdminProducts() {
  // -------------------------
  // STATES
  // -------------------------

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);

  const [updatingAvailabilityId, setUpdatingAvailabilityId] = useState(null);
  const [managingImagesProduct, setManagingImagesProduct] = useState(null);

  const formSectionRef = useRef(null);
  // -------------------------
  // LOAD PRODUCTS
  // -------------------------

  async function loadProducts() {
    try {
      const response = await getAdminProducts();

      setProducts(response.products ?? []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialProducts() {
      try {
        const response = await getAdminProducts();

        if (active) {
          setProducts(response.products ?? []);
          setError("");
        }
      } catch (err) {
        if (active) {
          setError(err.message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadInitialProducts();

    return () => {
      active = false;
    };
  }, []);

  // -------------------------
  // CREATE PRODUCT
  // -------------------------

  async function handleProductCreated(product) {
    setShowForm(false);
    setEditingProduct(null);

    setSuccess(
      `${product.name} was created successfully. You can now upload a photo.`,
    );

    setManagingImagesProduct(product);

    await loadProducts();
  }

  // -------------------------
  // EDIT PRODUCT
  // -------------------------

  function handleEditProduct(product) {
    setEditingProduct(product);
    setShowForm(false);
    setSuccess("");
    setError("");
    setManagingImagesProduct(null);
  }

  async function handleProductUpdated(product) {
    setEditingProduct(null);

    setSuccess(`${product.name} was updated successfully.`);

    await loadProducts();
  }

  useEffect(() => {
    if (
      !showForm &&
      !editingProduct &&
      !managingImagesProduct
    ) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [showForm, editingProduct, managingImagesProduct]);

  // A single photo workspace handles upload + management.
  function handlePhotos(product) {
    setManagingImagesProduct(product);
    setShowForm(false);
    setEditingProduct(null);
    setSuccess("");
    setError("");
  }

  // -------------------------
  // TOGGLE CREATE FORM
  // -------------------------

  function toggleForm() {
    if (showForm) {
      setShowForm(false);
      return;
    }

    setShowForm(true);
    setEditingProduct(null);
    setManagingImagesProduct(null);
    setSuccess("");
    setError("");
  }

  // -------------------------
  // UPDATE AVAILABILITY
  // -------------------------

  async function handleAvailabilityChange(product) {
    if (updatingAvailabilityId !== null) return;

    const newAvailability = !product.is_available;

    setUpdatingAvailabilityId(product.id);
    setError("");
    setSuccess("");

    try {
      const response = await updateProductAvailability(
        product.id,
        newAvailability,
      );

      // Update the row immediately using the server response
      setProducts((previous) =>
        previous.map((item) =>
          item.id === product.id
            ? {
                ...item,
                is_available: response.product.is_available,
              }
            : item,
        ),
      );

      setSuccess(
        `${product.name} is now ${
          response.product.is_available ? "available" : "unavailable"
        }.`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingAvailabilityId(null);
    }
  }

  function renderActions(product, mobile = false) {
    const base = mobile
      ? "min-h-11 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors"
      : "cursor-pointer text-sm font-medium hover:underline";
    const neutral = mobile
      ? "border-[#E7DCD9] bg-[#FAF7F5] text-[#B76473] hover:bg-[#FAF0F1]"
      : "text-[#B76473]";

    return (
      <div
        className={
          mobile
            ? "grid grid-cols-2 gap-2"
            : "flex flex-wrap items-center gap-4"
        }
      >
        <button
          type="button"
          onClick={() => handleEditProduct(product)}
          className={`${base} ${neutral}`}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => handlePhotos(product)}
          className={`${base} ${neutral}`}
        >
          Photos
        </button>
        <button
          type="button"
          disabled={updatingAvailabilityId !== null}
          onClick={() => handleAvailabilityChange(product)}
          className={`${base} disabled:cursor-not-allowed disabled:opacity-50 ${mobile ? "border-[#E7DCD9] bg-white" : ""} ${product.is_available ? "text-gray-600" : "text-green-700"}`}
        >
          {updatingAvailabilityId === product.id
            ? "Updating..."
            : product.is_available
              ? "Hide from store"
              : "Show in store"}
        </button>
      </div>
    );
  }

  function renderProductImage(product, mobile = false) {
    return product.image_url ? (
      <img
        src={product.image_url}
        alt={product.name}
        className={`${mobile ? "h-24 w-24 sm:h-28 sm:w-28" : "h-14 w-14"} shrink-0 rounded-xl bg-[#FAF7F5] object-cover`}
        onError={(event) => {
          event.currentTarget.onerror = null;
          event.currentTarget.style.display = "none";
        }}
      />
    ) : (
      <div
        className={`${mobile ? "h-24 w-24 sm:h-28 sm:w-28" : "h-14 w-14"} flex shrink-0 items-center justify-center rounded-xl bg-[#FAF0F1] px-2 text-center text-xs text-[#B76473]`}
      >
        No image
      </div>
    );
  }

  function renderStatus(product) {
    return (
      <span
        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${product.is_available ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}
      >
        {product.is_available ? "Available" : "Unavailable"}
      </span>
    );
  }

  return (
    <main className="min-w-0 px-4 py-6 sm:px-6 md:px-8 md:py-8 xl:p-10">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl leading-tight text-[#282323] sm:text-4xl">
            Product Management
          </h1>
          <p className="mt-2 text-sm text-[#756B69]">
            Manage your bakery products and inventory.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleForm}
          className="min-h-11 w-full cursor-pointer rounded-lg bg-[#D47783] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#B76473] sm:w-auto"
        >
          {showForm ? "Close Form" : "+ Add Product"}
        </button>
      </div>

      <AdminCategories onChanged={loadProducts} />

      {success && (
        <p
          role="status"
          className="mb-6 rounded-lg bg-green-50 p-4 text-sm text-green-700"
        >
          {success}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <div ref={formSectionRef} className="scroll-mt-6">
        {showForm && (
          <div className="mb-8 min-w-0">
            <AdminProductForm
              onClose={() => setShowForm(false)}
              onCreated={handleProductCreated}
            />
          </div>
        )}
        {editingProduct && (
          <div className="mb-8 min-w-0">
            <AdminProductEdit
              key={editingProduct.id}
              product={editingProduct}
              onClose={() => setEditingProduct(null)}
              onUpdated={handleProductUpdated}
            />
          </div>
        )}
        {managingImagesProduct && (
          <div className="mb-10 min-w-0">
            <AdminProductGallery
              key={managingImagesProduct.id}
              product={managingImagesProduct}
              onClose={() => setManagingImagesProduct(null)}
              onImagesUpdated={loadProducts}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div role="status" aria-label="Loading products" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({length:6},(_,i)=><div key={i} className="sba-skeleton h-48 rounded-2xl" />)}
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-[#E7DCD9] bg-white p-8 text-center text-sm text-[#756B69]">
          No products found.
        </div>
      ) : (
        <>
          {/* Mobile and tablet: responsive product cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 xl:hidden">
            {products.map((product) => (
              <article
                key={product.id}
                className="min-w-0 rounded-2xl border border-[#E7DCD9] bg-white p-4 shadow-sm"
              >
                <div className="flex min-w-0 items-start gap-3">
                  {renderProductImage(product, true)}
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-base font-semibold leading-snug text-[#282323]">
                      {product.name}
                    </h2>
                    <p className="mt-1 text-xs text-[#756B69]">
                      {product.category_name ?? "Uncategorized"}
                    </p>
                    <p className="mt-2 text-lg font-semibold text-[#B76473]">
                      ${Number(product.price).toFixed(2)}
                    </p>
                    <div className="mt-2">{renderStatus(product)}</div>
                  </div>
                </div>
                <div className="my-4 flex items-center justify-between border-y border-[#E7DCD9] py-3 text-sm">
                  <span className="text-[#756B69]">Sales mode</span>
                  <span className="font-semibold text-[#282323]">
                    {product.inventory_mode === "made_to_order" ? "Made to order" : "Stock by variant"}
                  </span>
                </div>
                {renderActions(product, true)}
              </article>
            ))}
          </div>

          {/* Large desktop: full product table */}
          <div className="hidden overflow-x-auto rounded-xl border border-[#E7DCD9] bg-white xl:block">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-[#B76473] text-xs uppercase tracking-wider text-white">
                <tr>
                  <th className="px-5 py-4">Product</th>
                  <th className="px-5 py-4">Category</th>
                  <th className="px-5 py-4">Price</th>
                  <th className="px-5 py-4">Sales mode</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7DCD9]">
                {products.map((product) => (
                  <tr
                    key={product.id}
                    className="transition-colors hover:bg-[#FAF7F5]"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-4">
                        {renderProductImage(product)}
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
                      {product.inventory_mode === "made_to_order" ? "Made to order" : "Stock by variant"}
                    </td>
                    <td className="px-5 py-4">{renderStatus(product)}</td>
                    <td className="px-5 py-4">{renderActions(product)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
