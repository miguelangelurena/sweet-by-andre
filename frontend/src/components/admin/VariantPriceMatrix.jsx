import { useEffect, useMemo, useState } from "react";
import { updateProductVariant } from "../../services/api";
import { compareOptionLabels } from "../../utils/naturalSort";

function VariantCell({ variant, label, onSaved, madeToOrder }) {
  const [price, setPrice] = useState(variant ? String(variant.price) : "");
  const [stock, setStock] = useState(variant ? String(variant.stock) : "");
  const [available, setAvailable] = useState(Boolean(variant?.is_available));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPrice(variant ? String(variant.price) : "");
    setStock(variant ? String(variant.stock) : "");
    setAvailable(Boolean(variant?.is_available));
    setError("");
  }, [variant?.id, variant?.price, variant?.stock, variant?.is_available]);

  if (!variant) {
    return <div className="rounded-xl bg-[#FAF7F5] p-4 text-xs text-[#867A77]">Not configured</div>;
  }

  const changed = price !== String(variant.price) || (!madeToOrder && stock !== String(variant.stock)) || available !== Boolean(variant.is_available);

  async function save() {
    if (busy) return;
    const nextPrice = Number(price);
    const nextStock = Number(stock);
    if (!price.trim() || !Number.isFinite(nextPrice) || nextPrice <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(price.trim())) {
      setError("Enter a price with up to 2 decimals.");
      return;
    }
    if (!stock.trim() || !Number.isSafeInteger(nextStock) || nextStock < 0) {
      setError("Stock must be a non-negative whole number.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await updateProductVariant(variant.id, {
        price: nextPrice,
        ...(madeToOrder ? {} : { stock: nextStock }),
        is_available: available,
      });
      await onSaved?.();
    } catch (err) {
      setError(err.message || "Could not save this variant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-[165px] space-y-2 rounded-xl border border-[#F0E5E2] bg-white p-3">
      <label className="block text-xs text-[#796D6A]">
        Price (USD)
        <input type="number" min="0.01" step="0.01" inputMode="decimal" aria-label={`${label} price`}
          value={price} onChange={(e) => setPrice(e.target.value)} disabled={busy}
          className="mt-1 w-full rounded-lg border border-[#E7DCD9] px-2.5 py-2 text-sm text-[#282323] focus-visible:outline-2 focus-visible:outline-[#B76473]" />
      </label>
      <label className={`${madeToOrder ? "hidden" : "block"} text-xs text-[#796D6A]`}>
        Stock
        <input type="number" min="0" step="1" inputMode="numeric" aria-label={`${label} stock`}
          value={stock} onChange={(e) => setStock(e.target.value)} disabled={busy}
          className="mt-1 w-full rounded-lg border border-[#E7DCD9] px-2.5 py-2 text-sm text-[#282323] focus-visible:outline-2 focus-visible:outline-[#B76473]" />
      </label>
      {madeToOrder && <p className="text-xs leading-5 text-[#796D6A]">Made to order · availability by date. Preparation load: {variant.production_points} points.</p>}
      <label className="flex cursor-pointer items-center gap-2 text-xs text-[#453B39]">
        <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)}
          disabled={busy} aria-label={`${label} available for purchase`} className="accent-[#B76473]" />
        For sale
      </label>
      <button type="button" onClick={save} disabled={!changed || busy}
        className="w-full cursor-pointer rounded-lg bg-[#B76473] px-3 py-2 text-xs font-semibold text-white hover:bg-[#A35363] disabled:cursor-not-allowed disabled:opacity-40">
        {busy ? "Saving…" : changed ? "Save changes" : "Saved"}
      </button>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

/**
 * Display one-option package/size variants as a simple list, or two-option
 * Flavor x Size / Package Size variants as a matrix.
 * Uses existing UUIDs; the SQL migration creates missing combinations.
 */
export default function VariantPriceMatrix({ options, variants, onSaved, madeToOrder=false }) {
  const sizeOption = useMemo(() => options.find((option) =>
    ["size", "cake size", "package size", "bites", "amount"].includes(option.name.trim().toLowerCase())), [options]);
  const flavorOption = useMemo(() => options.find((option) => option.name.trim().toLowerCase() === "flavor"), [options]);
  const valid = sizeOption && (options.length === 1 || (options.length === 2 && flavorOption));
  if (!valid) return null;

  const sizes = (sizeOption.values ?? []).filter((v) => v.is_active)
    .sort((a, b) => compareOptionLabels(a.value, b.value));
  const flavors = (flavorOption?.values ?? []).filter((v) => v.is_active)
    .sort((a, b) => a.value.localeCompare(b.value));

  if (!sizes.length || (flavorOption && !flavors.length)) return null;

  function findVariant(sizeId, flavorId = null) {
    return variants.find((variant) => {
      const selected = variant.options ?? [];
      if (selected.length !== (flavorOption ? 2 : 1)) return false;
      if (!selected.some((o) => o.option_id === sizeOption.id && o.value_id === sizeId)) return false;
      return !flavorOption || selected.some((o) => o.option_id === flavorOption.id && o.value_id === flavorId);
    });
  }

  return (
    <section aria-label="Manage prices and stock" className="mb-7 rounded-2xl border border-[#E7DCD9] bg-[#FFFCFA] p-4 sm:p-5">
      <h4 className="font-serif text-xl text-[#282323]">{flavorOption ? "Prices by flavor & package" : "Prices by size / package"}</h4>
      <p className="mb-4 mt-2 text-sm text-[#796D6A]">
        {madeToOrder ? "Manage prices and pause variants here. Preparation capacity is checked for the customer's chosen date." : "Manage prices and inventory without editing configurations one by one. A new variant starts with zero stock and is not for sale until you enable it."}
      </p>
      <div className="overflow-x-auto">
        {flavorOption ? (
          <table className="w-full min-w-[820px] border-separate border-spacing-2 text-left">
            <thead><tr>
              <th scope="col" className="min-w-32 px-2 text-sm font-semibold text-[#453B39]">Flavor</th>
              {sizes.map((size) => <th key={size.id} scope="col" className="px-2 text-sm font-semibold text-[#453B39]">{size.value}</th>)}
            </tr></thead>
            <tbody>{flavors.map((flavor) => <tr key={flavor.id}>
              <th scope="row" className="px-2 pt-5 align-top text-sm font-semibold text-[#453B39]">{flavor.value}</th>
              {sizes.map((size) => <td key={size.id} className="align-top">
                <VariantCell variant={findVariant(size.id, flavor.id)} label={`${flavor.value}, ${size.value}`} onSaved={onSaved} madeToOrder={madeToOrder} />
              </td>)}
            </tr>)}</tbody>
          </table>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sizes.map((size) => <div key={size.id}>
              <h5 className="mb-2 text-sm font-semibold text-[#453B39]">{size.value} {sizeOption.name === "Package Size" ? "pieces" : ""}</h5>
              <VariantCell variant={findVariant(size.id)} label={`${sizeOption.name}: ${size.value}`} onSaved={onSaved} madeToOrder={madeToOrder} />
            </div>)}
          </div>
        )}
      </div>
    </section>
  );
}
