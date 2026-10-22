import { useEffect, useState } from "react";
import { createProduct, getCategories } from "../../services/api";

const initialForm = {
  name: "",
  description: "",
  price: "",
  stock: "0",
  category_id: "",
};

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

    if (form.price.trim() === "" || !Number.isFinite(price) || price <= 0) {
      setError("Enter a valid price greater than zero.");
      return;
    }

    if (form.stock.trim() === "" || !Number.isInteger(stock) || stock < 0) {
      setError("Stock must be a non-negative integer.");
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

      onCreated(response.product);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-[#E7DCD9] " +
    "bg-white px-4 py-3 text-sm text-[#282323] " +
    "outline-none focus:border-[#D47783]";

  return (
    <section className="mb-8 rounded-xl border border-[#E7DCD9] bg-white p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-serif text-2xl text-[#282323]">Add New Product</h2>

        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="text-sm text-[#756B69] hover:text-[#B76473]"
        >
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor="product-name"
            className="mb-2 block text-sm font-medium"
          >
            Product Name
          </label>

          <input
            id="product-name"
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            maxLength={150}
            className={inputClass}
            placeholder="e.g. Vanilla Birthday Cake"
          />
        </div>

        <div>
          <label
            htmlFor="product-description"
            className="mb-2 block text-sm font-medium"
          >
            Description
          </label>

          <textarea
            id="product-description"
            name="description"
            value={form.description}
            onChange={handleChange}
            rows={3}
            className={inputClass}
            placeholder="Describe the product..."
          />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label
              htmlFor="product-price"
              className="mb-2 block text-sm font-medium"
            >
              Price (USD)
            </label>

            <input
              id="product-price"
              name="price"
              type="number"
              min="0.01"
              step="0.01"
              value={form.price}
              onChange={handleChange}
              required
              className={inputClass}
              placeholder="45.00"
            />
          </div>

          <div>
            <label
              htmlFor="product-stock"
              className="mb-2 block text-sm font-medium"
            >
              Stock
            </label>

            <input
              id="product-stock"
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
            htmlFor="product-category"
            className="mb-2 block text-sm font-medium"
          >
            Category
          </label>

          <select
            id="product-category"
            name="category_id"
            value={form.category_id}
            onChange={handleChange}
            required
            disabled={loadingCategories}
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
            disabled={loading || loadingCategories || categories.length === 0}
            className="rounded-lg bg-[#D47783] px-6 py-3 text-sm font-semibold text-white hover:bg-[#B76473] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Creating..." : "Create Product"}
          </button>
        </div>
      </form>
    </section>
  );
}
