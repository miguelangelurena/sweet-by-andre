import { useEffect, useState } from "react";
import { updateProductVariant } from "../../services/api";

const numericSort = (a, b) => {
  const na = Number.parseInt(String(a.value).match(/\d+/)?.[0] ?? "", 10);
  const nb = Number.parseInt(String(b.value).match(/\d+/)?.[0] ?? "", 10);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a.value).localeCompare(String(b.value), undefined, { numeric: true });
};

function PriceCell({ variant, flavorName, sizeName, onSaved }) {
  const [price, setPrice] = useState(variant ? String(variant.price) : "");
  const [stock, setStock] = useState(variant ? String(variant.stock) : "");
  const [available, setAvailable] = useState(Boolean(variant?.is_available));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPrice(variant ? String(variant.price) : "");
    setStock(variant ? String(variant.stock) : "");
    setAvailable(Boolean(variant?.is_available));
    setError("");
  }, [variant?.id, variant?.price, variant?.stock, variant?.is_available]);

  if (!variant) {
    return (
      <div className="rounded-xl bg-[#FAF7F5] px-3 py-4 text-xs text-[#867A77]">
        Not configured
      </div>
    );
  }

  const isDirty =
    price !== String(variant.price) ||
    stock !== String(variant.stock) ||
    available !== variant.is_available;

  async function save() {
    const nextPrice = Number(price);
    const nextStock = Number(stock);
    if (!price.trim() || !Number.isFinite(nextPrice) || nextPrice <= 0) {
      setError("Enter a valid price.");
      return;
    }
    if (!stock.trim() || !Number.isInteger(nextStock) || nextStock < 0) {
      setError("Enter a valid stock.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateProductVariant(variant.id, {
        price: nextPrice,
        stock: nextStock,
        is_available: available,
      });
      await onSaved?.();
    } catch (err) {
      setError(err.message || "Could not save this variant.");
    } finally {
      setSaving(false);
    }
  }

  const cellLabel = `${flavorName}, ${sizeName}`;

  return (
    <div className="min-w-[170px] space-y-2 rounded-xl border border-[#F0E5E2] bg-white p-3">
      <label className="block text-xs text-[#796D6A]">
        Price ($)
        <input
          aria-label={`${cellLabel} price (USD)`}
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          disabled={saving}
          className="mt-1 w-full rounded-lg border border-[#E7DCD9] px-2.5 py-2 text-sm text-[#282323] focus-visible:outline-2 focus-visible:outline-[#B76473]"
        />
      </label>
      <label className="block text-xs text-[#796D6A]">
        Stock
        <input
          aria-label={`${cellLabel} stock`}
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          disabled={saving}
          className="mt-1 w-full rounded-lg border border-[#E7DCD9] px-2.5 py-2 text-sm text-[#282323] focus-visible:outline-2 focus-visible:outline-[#B76473]"
        />
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-[#453B39]">
        <input
          aria-label={`${cellLabel} available`}
          type="checkbox"
          checked={available}
          onChange={(e) => setAvailable(e.target.checked)}
          disabled={saving}
          className="accent-[#B76473]"
        />
        For sale
      </label>
      <button
        type="button"
        onClick={save}
        disabled={!isDirty || saving}
        className="w-full cursor-pointer rounded-lg bg-[#B76473] px-3 py-2 text-xs font-semibold text-white hover:bg-[#A35363] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? "Saving…" : isDirty ? "Save changes" : "Saved"}
      </button>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

/**
 * A friendly matrix for products configured with Flavor + Size options.
 * Uses existing variant UUIDs; it never creates/deletes variants.
 */
export default function VariantPriceMatrix({ options, variants, onSaved }) {
  const flavorOption = options.find((o) => o.name.trim().toLowerCase() === "flavor");
  const sizeOption = options.find((o) => ["size", "cake size"].includes(o.name.trim().toLowerCase()));
  if (!flavorOption || !sizeOption || options.length !== 2) return null;

  const flavors = (flavorOption.values ?? []).filter((v) => v.is_active);
  const sizes = (sizeOption.values ?? []).filter((v) => v.is_active).sort(numericSort);
  if (!flavors.length || !sizes.length) return null;

  const findVariant = (flavorId, sizeId) =>
    variants.find((variant) =>
      variant.options?.length === 2 &&
      variant.options.some((o) => o.option_id === flavorOption.id && o.value_id === flavorId) &&
      variant.options.some((o) => o.option_id === sizeOption.id && o.value_id === sizeId),
    );

  return (
    <section aria-label="Prices by flavor and size" className="mb-7 rounded-2xl border border-[#E7DCD9] bg-[#FFFCFA] p-4 sm:p-5">
      <h4 className="font-serif text-xl text-[#282323]">Prices by flavor & size</h4>
      <p className="mb-4 mt-2 text-sm text-[#796D6A]">
        Edit prices, inventory, and sale status directly in the table.
        A variant is visible to customers only when it is for sale and stock is greater than zero.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-separate border-spacing-2 text-left">
          <thead>
            <tr>
              <th scope="col" className="min-w-[140px] px-2 text-sm font-semibold text-[#453B39]">Flavor</th>
              {sizes.map((size) => <th scope="col" key={size.id} className="px-2 text-sm font-semibold text-[#453B39]">{size.value}</th>)}
            </tr>
          </thead>
          <tbody>
            {flavors.map((flavor) => (
              <tr key={flavor.id}>
                <th scope="row" className="align-top px-2 pt-5 text-sm font-semibold text-[#453B39]">{flavor.value}</th>
                {sizes.map((size) => (
                  <td key={size.id} className="align-top">
                    <PriceCell
                      variant={findVariant(flavor.id, size.id)}
                      flavorName={flavor.value}
                      sizeName={size.value}
                      onSaved={onSaved}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
