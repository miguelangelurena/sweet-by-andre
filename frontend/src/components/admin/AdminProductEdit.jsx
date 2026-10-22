import { useEffect, useState } from "react";
import { getCategories, updateProduct } from "../../services/api";

export default function AdminProductEdit({ product, onClose, onUpdated }) {
  const [form, setForm] = useState({
    name: product.name ?? "",
    description: product.description ?? "",
    price: String(product.price ?? ""),
    stock: String(product.stock ?? 0),
    category_id: product.category_id ?? "",
  });

  const [categories, setCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadCategories() {
      try {
        const response = await getCategories();

        if (active) {
          setCategories(response.categories ?? []);
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

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const price = Number(form.price);
    const stock = Number(form.stock);

    if (!form.name.trim()) {
      setError("Product name is required.");
      return;
    }

    if (form.price.trim() === "" || !Number.isFinite(price) || price <= 0) {
      setError("Price must be greater than zero.");
      return;
    }

    if (form.stock.trim() === "" || !Number.isInteger(stock) || stock < 0) {
      setError("Stock must be a non-negative integer.");
      return;
    }

    if (!form.category_id) {
      setError("Please select a category.");
      return;
    }

    setSaving(true);

    try {
      const response = await updateProduct(product.id, {
        name: form.name.trim(),
        description: form.description.trim(),
        price,
        stock,
        category_id: form.category_id,
      });

      await onUpdated(response.product);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-[#E7DCD9] " +
    "bg-white px-4 py-3 text-sm text-[#282323] " +
    "outline-none focus:border-[#D47783]";

  return (
    <section className="mb-8 rounded-xl border border-[#E7DCD9] bg-white p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl text-[#282323]">Edit Product</h2>

          <p className="mt-1 text-sm text-[#756B69]">Editing: {product.name}</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="cursor-pointer text-sm text-[#756B69] hover:text-[#B76473] disabled:cursor-not-allowed"
        >
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="edit-name" className="mb-2 block text-sm font-medium">
            Product Name
          </label>

          <input
            id="edit-name"
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            className={inputClass}
          />
        </div>

        <div>
          <label
            htmlFor="edit-description"
            className="mb-2 block text-sm font-medium"
          >
            Description
          </label>

          <textarea
            id="edit-description"
            name="description"
            value={form.description}
            onChange={handleChange}
            rows={3}
            className={inputClass}
          />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label
              htmlFor="edit-price"
              className="mb-2 block text-sm font-medium"
            >
              Price (USD)
            </label>

            <input
              id="edit-price"
              name="price"
              type="number"
              min="0.01"
              step="0.01"
              value={form.price}
              onChange={handleChange}
              required
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="edit-stock"
              className="mb-2 block text-sm font-medium"
            >
              Stock
            </label>

            <input
              id="edit-stock"
              name="stock"
              type="number"
              min="0"
              step="1"
              value={form.stock}
              onChange={handleChange}
              required
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="edit-category"
            className="mb-2 block text-sm font-medium"
          >
            Category
          </label>

          <select
            id="edit-category"
            name="category_id"
            value={form.category_id}
            onChange={handleChange}
            disabled={loadingCategories}
            required
            className={inputClass}
          >
            <option value="">Select a category</option>

            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || loadingCategories}
            className="cursor-pointer rounded-lg bg-[#D47783] px-6 py-3 text-sm font-semibold text-white hover:bg-[#B76473] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </section>
  );
}
