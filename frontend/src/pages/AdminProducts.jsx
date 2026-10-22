import { useEffect, useState } from "react";
import { getAdminProducts, updateProductAvailability } from "../services/api";

import AdminProductForm from "../components/admin/AdminProductForm";
import ProductImageUpload from "../components/admin/ProductImageUpload";
import AdminProductEdit from "../components/admin/AdminProductEdit";

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
  const [imageProduct, setImageProduct] = useState(null);

  const [updatingAvailabilityId, setUpdatingAvailabilityId] = useState(null);

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

    setImageProduct(product);

    await loadProducts();
  }

  // -------------------------
  // EDIT PRODUCT
  // -------------------------

  function handleEditProduct(product) {
    setEditingProduct(product);
    setShowForm(false);
    setImageProduct(null);
    setSuccess("");
    setError("");
  }

  async function handleProductUpdated(product) {
    setEditingProduct(null);

    setSuccess(`${product.name} was updated successfully.`);

    await loadProducts();
  }

  // -------------------------
  // UPLOAD IMAGE
  // -------------------------

  function handleAddImage(product) {
    setImageProduct(product);
    setShowForm(false);
    setEditingProduct(null);
    setSuccess("");
    setError("");
  }

  async function handleImageUploaded() {
    setImageProduct(null);
    setSuccess("Product image uploaded successfully.");

    await loadProducts();
  }

  function handleImageCancel() {
    setImageProduct(null);
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
    setImageProduct(null);
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

  // -------------------------
  // RENDER
  // -------------------------

  return (
    <main className="p-6 md:p-10">
      {/* PAGE HEADER */}

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
          onClick={toggleForm}
          className="cursor-pointer rounded-lg bg-[#D47783] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#B76473]"
        >
          {showForm ? "Close Form" : "+ Add Product"}
        </button>
      </div>

      {/* SUCCESS MESSAGE */}

      {success && (
        <p
          role="status"
          className="mb-6 rounded-lg bg-green-50 p-4 text-sm text-green-700"
        >
          {success}
        </p>
      )}

      {/* ERROR MESSAGE */}

      {error && (
        <p
          role="alert"
          className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {/* CREATE PRODUCT FORM */}

      {showForm && (
        <AdminProductForm
          onClose={() => setShowForm(false)}
          onCreated={handleProductCreated}
        />
      )}

      {/* EDIT PRODUCT FORM */}

      {editingProduct && (
        <AdminProductEdit
          key={editingProduct.id}
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onUpdated={handleProductUpdated}
        />
      )}

      {/* IMAGE UPLOAD FORM */}

      {imageProduct && (
        <div className="mb-8">
          <p className="mb-3 text-sm font-medium text-[#282323]">
            Adding image for: {imageProduct.name}
          </p>

          <ProductImageUpload
            productId={imageProduct.id}
            onUploaded={handleImageUploaded}
            onCancel={handleImageCancel}
          />
        </div>
      )}

      {/* LOADING STATE */}

      {loading && <p className="text-sm text-[#756B69]">Loading products...</p>}

      {/* PRODUCTS TABLE */}

      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-[#E7DCD9] bg-white">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-[#B76473] text-xs uppercase tracking-wider text-white">
              <tr>
                <th className="px-5 py-4">Product</th>
                <th className="px-5 py-4">Category</th>
                <th className="px-5 py-4">Price</th>
                <th className="px-5 py-4">Stock</th>
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
                  {/* PRODUCT */}

                  <td className="px-5 py-4">
                    <div className="flex items-center gap-4">
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="h-14 w-14 rounded-lg object-cover"
                          onError={(event) => {
                            event.currentTarget.onerror = null;

                            const fallback = `
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="56"
                                height="56"
                              >
                                <rect
                                  width="56"
                                  height="56"
                                  rx="8"
                                  fill="#FAF0F1"
                                />
                                <text
                                  x="28"
                                  y="30"
                                  text-anchor="middle"
                                  font-size="9"
                                  fill="#B76473"
                                >
                                  No image
                                </text>
                              </svg>
                            `;

                            event.currentTarget.src =
                              "data:image/svg+xml," +
                              encodeURIComponent(fallback);
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

                  {/* CATEGORY */}

                  <td className="px-5 py-4 text-sm text-[#756B69]">
                    {product.category_name ?? "Uncategorized"}
                  </td>

                  {/* PRICE */}

                  <td className="px-5 py-4 text-sm font-medium text-[#282323]">
                    ${Number(product.price).toFixed(2)}
                  </td>

                  {/* STOCK */}

                  <td className="px-5 py-4 text-sm text-[#756B69]">
                    {product.stock}
                  </td>

                  {/* STATUS */}

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

                  {/* ACTION BUTTONS */}

                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-4">
                      <button
                        type="button"
                        onClick={() => handleEditProduct(product)}
                        className="cursor-pointer text-sm font-medium text-[#B76473] hover:underline"
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAddImage(product)}
                        className="cursor-pointer text-sm font-medium text-[#B76473] hover:underline"
                      >
                        Add Image
                      </button>

                      <button
                        type="button"
                        disabled={updatingAvailabilityId !== null}
                        onClick={() => handleAvailabilityChange(product)}
                        className={`cursor-pointer text-sm font-semibold hover:underline disabled:cursor-not-allowed disabled:opacity-50 ${
                          product.is_available
                            ? "text-gray-600"
                            : "text-green-700"
                        }`}
                      >
                        {updatingAvailabilityId === product.id
                          ? "Updating..."
                          : product.is_available
                            ? "Deactivate"
                            : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* EMPTY STATE */}

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
