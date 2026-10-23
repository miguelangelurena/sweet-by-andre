import { useEffect, useState } from "react";
import { createProduct, getCategories } from "../../services/api";

const initialForm = {
  name: "",
  description: "",
  price: "",
  stock: "0",
  category_id: "",
};

const inputClass =
  "w-full min-w-0 rounded-xl border border-[#E7DCD9] bg-white px-4 py-3 " +
  "text-base text-[#282323] placeholder:text-[#A49A97] outline-none " +
  "transition-colors focus:border-[#D47783] focus:ring-2 focus:ring-[#D47783]/15 " +
  "disabled:cursor-not-allowed disabled:bg-[#FAF7F5] disabled:opacity-70 sm:text-sm";

export default function AdminProductForm({ onClose, onCreated }) {
  const [form, setForm] = useState(initialForm);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadCategories() {
      try {
        const response = await getCategories();
        if (active) {
          setCategories(
            (response.categories ?? []).filter(
              (category) => category.is_active !== false,
            ),
          );
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoadingCategories(false);
      }
    }

    loadCategories();
    return () => {
      active = false;
    };
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;
    setError("");

    const price = Number(form.price);
    const stock = Number(form.stock);

    if (!form.name.trim()) {
      setError("Enter a product name.");
      return;
    }

    if (form.price.trim() === "" || !Number.isFinite(price) || price <= 0) {
      setError("Enter a valid price greater than zero.");
      return;
    }

    if (form.stock.trim() === "" || !Number.isInteger(stock) || stock < 0) {
      setError("Stock must be a non-negative integer.");
      return;
    }

    if (
      !form.category_id ||
      !categories.some((c) => c.id === form.category_id)
    ) {
      setError("Select a valid category.");
      return;
    }

    setLoading(true);
    try {
      const response = await createProduct({
        name: form.name.trim(),
        description: form.description.trim(),
        price,
        stock,
        category_id: form.category_id,
      });
      await onCreated(response.product);
    } catch (err) {
      setError(
        err.message || "Unable to create the product. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mb-8 overflow-hidden rounded-2xl border border-[#E7DCD9] bg-white shadow-sm">
      <div className="border-b border-[#F0E7E5] bg-[#FAF7F5] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#B76473]">
              Product catalog
            </p>
            <h2 className="font-serif text-2xl text-[#282323] sm:text-3xl">
              Add New Product
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#756B69]">
              Add the product details below. You can upload photos after
              creating it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="self-start rounded-lg border border-[#E7DCD9] bg-white px-4 py-2 text-sm font-medium text-[#756B69] transition-colors hover:bg-[#F6EEEC] hover:text-[#B76473] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
      >
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <label
              htmlFor="product-name"
              className="mb-2 block text-sm font-semibold text-[#282323]"
            >
              Product Name <span className="text-[#B76473]">*</span>
            </label>
            <input
              id="product-name"
              name="name"
              value={form.name}
              onChange={handleChange}
              disabled={loading}
              required
              maxLength={150}
              autoComplete="off"
              className={inputClass}
              placeholder="e.g. Vanilla Birthday Cake"
            />
          </div>

          <div>
            <label
              htmlFor="product-description"
              className="mb-2 block text-sm font-semibold text-[#282323]"
            >
              Description
            </label>
            <textarea
              id="product-description"
              name="description"
              value={form.description}
              onChange={handleChange}
              disabled={loading}
              rows={4}
              className={`${inputClass} resize-y`}
              placeholder="Describe the product, flavors, and details..."
            />
            <p className="mt-1.5 text-xs text-[#8A807D]">
              Optional. Help customers know what makes this product special.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label
                htmlFor="product-price"
                className="mb-2 block text-sm font-semibold text-[#282323]"
              >
                Price (USD) <span className="text-[#B76473]">*</span>
              </label>
              <input
                id="product-price"
                name="price"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={form.price}
                onChange={handleChange}
                disabled={loading}
                required
                className={inputClass}
                placeholder="45.00"
              />
            </div>
            <div>
              <label
                htmlFor="product-stock"
                className="mb-2 block text-sm font-semibold text-[#282323]"
              >
                Stock <span className="text-[#B76473]">*</span>
              </label>
              <input
                id="product-stock"
                name="stock"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={form.stock}
                onChange={handleChange}
                disabled={loading}
                required
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="product-category"
              className="mb-2 block text-sm font-semibold text-[#282323]"
            >
              Category <span className="text-[#B76473]">*</span>
            </label>
            <select
              id="product-category"
              name="category_id"
              value={form.category_id}
              onChange={handleChange}
              disabled={loading || loadingCategories || categories.length === 0}
              required
              className={inputClass}
            >
              <option value="">
                {loadingCategories
                  ? "Loading categories..."
                  : "Select a category"}
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {!loadingCategories && categories.length === 0 && (
              <p className="mt-2 text-sm text-amber-700">
                No active categories are available. Create or activate a
                category first.
              </p>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-[#F0E7E5] pt-6 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="w-full cursor-pointer rounded-xl border border-[#E7DCD9] px-5 py-3 text-sm font-semibold text-[#756B69] transition-colors hover:bg-[#FAF7F5] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || loadingCategories || categories.length === 0}
              className="w-full cursor-pointer rounded-xl bg-[#D47783] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#B76473] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {loading ? "Creating Product..." : "Create Product"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
