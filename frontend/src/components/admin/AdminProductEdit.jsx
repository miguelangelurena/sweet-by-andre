import MinimalSelect from "../ui/MinimalSelect";
import { useEffect, useState } from "react";
import { getCategories, updateProduct } from "../../services/api";
import AdminProductVariants from "./AdminProductVariants";

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
        if (active) setCategories(response.categories ?? []);
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
    if (saving) return;
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
    "w-full min-w-0 rounded-xl border border-[#E7DCD9] bg-white px-4 py-3 " +
    "text-base text-[#282323] outline-none transition-colors " +
    "placeholder:text-[#A79A97] focus:border-[#D47783] focus:ring-2 " +
    "focus:ring-[#D47783]/15 disabled:cursor-not-allowed disabled:bg-[#FAF7F5] " +
    "sm:text-sm";
  const labelClass = "mb-2 block text-sm font-semibold text-[#453B39]";

  return (
    <>
      <section className="mb-8 min-w-0 overflow-hidden rounded-2xl border border-[#E7DCD9] bg-white shadow-sm">
        <div className="border-b border-[#F0E6E4] bg-[#FAF7F5] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#B76473]">
                Product Management
              </p>
              <h2 className="font-serif text-2xl text-[#282323] sm:text-3xl">
                Edit Product
              </h2>
              <p className="mt-2 break-words text-sm text-[#756B69]">
                Editing:{" "}
                <span className="font-medium text-[#453B39]">
                  {product.name}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="w-full cursor-pointer rounded-xl border border-[#E7DCD9] bg-white px-4 py-2.5 text-sm font-medium text-[#756B69] transition-colors hover:bg-[#F7EEEE] hover:text-[#B76473] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              Cancel
            </button>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-7 lg:px-8"
        >
          <div>
            <label htmlFor="edit-name" className={labelClass}>
              Product Name
            </label>
            <input
              id="edit-name"
              name="name"
              value={form.name}
              onChange={handleChange}
              required
              maxLength={150}
              disabled={saving}
              className={inputClass}
              placeholder="e.g. Vanilla Birthday Cake"
            />
          </div>

          <div>
            <label htmlFor="edit-description" className={labelClass}>
              Description
            </label>
            <textarea
              id="edit-description"
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={4}
              disabled={saving}
              className={`${inputClass} resize-y`}
              placeholder="Describe the product..."
            />
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="edit-price" className={labelClass}>
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
                disabled={saving}
                inputMode="decimal"
                className={inputClass}
                placeholder="45.00"
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="edit-stock" className={labelClass}>
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
                disabled={saving}
                inputMode="numeric"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label  className={labelClass}>
              Category
            </label>
            <MinimalSelect label="Product category" value={form.category_id}
              onChange={value=>setForm(prev=>({...prev,category_id:value}))}
              disabled={loadingCategories || saving}
              options={[{value:"",label:loadingCategories?"Loading categories...":"Select a category"},...categories.map(c=>({value:c.id,label:c.name}))]} />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-[#F0E6E4] pt-5 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="w-full cursor-pointer rounded-xl border border-[#E7DCD9] px-6 py-3 text-sm font-semibold text-[#756B69] transition-colors hover:bg-[#FAF7F5] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || loadingCategories}
              className="w-full cursor-pointer rounded-xl bg-[#D47783] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#B76473] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </section>
      <AdminProductVariants productId={product.id} />
    </>
  );
}
