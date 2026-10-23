import { useEffect, useMemo, useState } from "react";
import { getProductById, getProductVariants } from "../services/api";

const formatPrice = (price) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(price));

export default function ProductDetail({ productId }) {
  const [product, setProduct] = useState(null);
  const [variants, setVariants] = useState([]);
  const [selectedValues, setSelectedValues] = useState({});
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadProduct() {
      setLoading(true);
      setError("");
      setProduct(null);
      setVariants([]);
      setSelectedValues({});
      setSelectedImage(0);
      setQuantity(1);
      setNotes("");

      try {
        const [productResponse, variantsResponse] = await Promise.all([
          getProductById(productId),
          getProductVariants(productId),
        ]);
        if (!active) return;
        const availableVariants = variantsResponse.variants ?? [];
        setProduct(productResponse.product);
        setVariants(availableVariants);

        // Select the first purchasable configuration initially.
        const first = availableVariants[0];
        if (first) {
          setSelectedValues(
            Object.fromEntries(
              (first.options ?? []).map((option) => [
                option.option_id,
                option.value_id,
              ]),
            ),
          );
        }
      } catch (err) {
        if (active) setError(err.message || "Could not load product.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadProduct();
    return () => {
      active = false;
    };
  }, [productId]);

  const optionGroups = useMemo(() => {
    const groups = new Map();
    for (const variant of variants) {
      for (const option of variant.options ?? []) {
        if (!groups.has(option.option_id)) {
          groups.set(option.option_id, {
            id: option.option_id,
            name: option.option_name,
            values: new Map(),
          });
        }
        groups.get(option.option_id).values.set(option.value_id, {
          id: option.value_id,
          label: option.value,
        });
      }
    }
    return [...groups.values()].map((group) => ({
      ...group,
      values: [...group.values.values()],
    }));
  }, [variants]);

  const selectedVariant = useMemo(() => {
    if (variants.length === 0) return null;
    return (
      variants.find((variant) => {
        const configured = variant.options ?? [];
        return (
          configured.length === optionGroups.length &&
          configured.every(
            (option) => selectedValues[option.option_id] === option.value_id,
          )
        );
      }) ?? null
    );
  }, [variants, optionGroups, selectedValues]);

  // Only offer values that can lead to an existing purchasable combination,
  // given selections in all other groups.
  function valueIsSelectable(optionId, valueId) {
    return variants.some((variant) => {
      const configured = variant.options ?? [];
      if (
        !configured.some(
          (option) =>
            option.option_id === optionId && option.value_id === valueId,
        )
      ) {
        return false;
      }
      return configured.every(
        (option) =>
          option.option_id === optionId ||
          !selectedValues[option.option_id] ||
          selectedValues[option.option_id] === option.value_id,
      );
    });
  }

  function chooseValue(optionId, valueId) {
    const next = { ...selectedValues, [optionId]: valueId };
    const matching = variants.find((variant) =>
      (variant.options ?? []).every(
        (option) =>
          !next[option.option_id] || next[option.option_id] === option.value_id,
      ),
    );
    if (matching) {
      for (const option of matching.options ?? []) {
        next[option.option_id] = option.value_id;
      }
    }
    setSelectedValues(next);
    setQuantity(1);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#FAF7F5] px-6 py-24 text-center text-[#796D6A]">
        Loading product...
      </main>
    );
  }

  if (error || !product) {
    return (
      <main className="min-h-screen bg-[#FAF7F5] px-6 py-24 text-center">
        <p role="alert" className="text-red-700">
          {error || "Product not found."}
        </p>
        <a href="#catalog" className="mt-5 inline-block text-[#B76473]">
          Back to catalog
        </a>
      </main>
    );
  }

  const images = product.images ?? [];
  const inStock = Boolean(selectedVariant) && Number(selectedVariant.stock) > 0;
  const maxQuantity = inStock ? Math.floor(Number(selectedVariant.stock)) : 0;
  const subtotal = selectedVariant
    ? Number(selectedVariant.price) * quantity
    : 0;

  return (
    <main className="min-h-screen bg-[#FAF7F5] px-4 py-10 sm:px-6 lg:py-16">
      <div className="mx-auto max-w-7xl">
        <a
          href="#catalog"
          className="mb-8 inline-block text-sm font-medium text-[#B76473] hover:underline"
        >
          ← Back to our menu
        </a>

        <div className="grid gap-12 lg:grid-cols-2">
          <section>
            <div className="aspect-square overflow-hidden rounded-3xl bg-[#F1E5E2]">
              {images.length > 0 ? (
                <img
                  src={images[selectedImage]?.image_url}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center font-serif text-3xl italic text-[#B76473]">
                  Sweet by Andre
                </div>
              )}
            </div>

            {images.length > 1 && (
              <div className="mt-4 grid grid-cols-5 gap-3">
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => setSelectedImage(index)}
                    aria-label={`View product image ${index + 1}`}
                    aria-pressed={selectedImage === index}
                    className={`aspect-square overflow-hidden rounded-xl border-2 ${
                      selectedImage === index
                        ? "border-[#B76473]"
                        : "border-transparent"
                    }`}
                  >
                    <img
                      src={image.image_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="lg:py-6">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#B76473]">
              {product.category_name}
            </p>
            <h1 className="mt-4 font-serif text-4xl text-[#282323] sm:text-5xl">
              {product.name}
            </h1>
            <p className="mt-5 text-3xl font-semibold text-[#282323]">
              {selectedVariant
                ? formatPrice(selectedVariant.price)
                : "Currently unavailable"}
            </p>
            <p className="mt-7 whitespace-pre-line leading-8 text-[#796D6A]">
              {product.description}
            </p>

            {optionGroups.length > 0 && (
              <div className="mt-8 space-y-5 border-t border-[#E7DCD9] pt-7">
                {optionGroups.map((group) => (
                  <div key={group.id}>
                    <label
                      htmlFor={`product-option-${group.id}`}
                      className="mb-2 block text-sm font-semibold text-[#282323]"
                    >
                      {group.name}
                    </label>
                    <select
                      id={`product-option-${group.id}`}
                      value={selectedValues[group.id] ?? ""}
                      onChange={(event) =>
                        chooseValue(group.id, event.target.value)
                      }
                      className="w-full rounded-xl border border-[#E7DCD9] bg-white px-4 py-3 text-[#282323] outline-none focus:border-[#B76473]"
                    >
                      {group.values.map((value) => (
                        <option
                          key={value.id}
                          value={value.id}
                          disabled={!valueIsSelectable(group.id, value.id)}
                        >
                          {value.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-8 border-t border-[#E7DCD9] pt-7">
              <p
                className={`text-sm font-semibold ${inStock ? "text-green-700" : "text-[#A29A97]"}`}
              >
                {inStock
                  ? `Available (${maxQuantity} in stock)`
                  : "Out of stock"}
              </p>
              <div className="mt-7">
                <label className="text-sm font-semibold text-[#282323]">
                  Quantity
                </label>
                <div className="mt-3 flex items-center gap-5">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={!inStock || quantity <= 1}
                    aria-label="Decrease quantity"
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E7DCD9] bg-white disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="min-w-6 text-center text-lg font-semibold">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setQuantity((q) => Math.min(maxQuantity, q + 1))
                    }
                    disabled={!inStock || quantity >= maxQuantity}
                    aria-label="Increase quantity"
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E7DCD9] bg-white disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="mt-8">
                <label
                  htmlFor="special-instructions"
                  className="text-sm font-semibold text-[#282323]"
                >
                  Special instructions (optional)
                </label>
                <textarea
                  id="special-instructions"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={500}
                  rows={4}
                  placeholder="Any special requests for your dessert?"
                  className="mt-3 w-full resize-y rounded-2xl border border-[#E7DCD9] bg-white p-4 text-sm outline-none focus:border-[#B76473]"
                />
              </div>

              <div className="mt-8 flex items-center justify-between border-t border-[#E7DCD9] pt-6">
                <span className="text-sm text-[#796D6A]">Subtotal</span>
                <span className="text-2xl font-semibold text-[#282323]">
                  {selectedVariant ? formatPrice(subtotal) : "—"}
                </span>
              </div>
              <button
                type="button"
                disabled
                className="mt-7 w-full rounded-full bg-[#B76473] px-8 py-4 font-semibold text-white opacity-60"
              >
                {inStock ? "Add to Cart — Coming Soon" : "Out of Stock"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
