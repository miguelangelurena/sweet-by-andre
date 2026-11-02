import { useEffect, useMemo, useState } from "react";
import { getProductById, getProductVariants } from "../services/api";
import { ProductDetailSkeleton } from "../components/ui/Skeleton";
import MinimalSelect from "../components/ui/MinimalSelect";
import { compareOptionLabels } from "../utils/naturalSort";

// Set VITE_API_BASE_URL in frontend/.env to the Express origin (without /api).
// For local development the default expects Express on port 3000.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(
  /\/$/,
  "",
);

async function guestCartRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      ...options,
    });
  } catch {
    throw new Error("Cannot connect to the shop. Please try again.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Request failed (${response.status}).`);
  }
  return data;
}

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
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addingToCart, setAddingToCart] = useState(false);
  const [cartMessage, setCartMessage] = useState("");
  const [cartError, setCartError] = useState("");

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
      setDescriptionExpanded(false);
      setCartMessage("");
      setCartError("");

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
      // Numeric-aware ordering: 4" < 6" < 8" < 10", 2 pieces < 6 pieces.
      values: [...group.values.values()].sort((a, b) =>
        compareOptionLabels(a.label, b.label),
      ),
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
    setCartMessage("");
  }

  async function handleAddToCart() {
    if (!selectedVariant || addingToCart || quantity < 1) return;

    setAddingToCart(true);
    setCartError("");
    setCartMessage("");

    try {
      // Creating the cart again is safe: existing guest cookies recover it.
      await guestCartRequest("/api/guest/cart", { method: "POST" });

      const { csrf_token } = await guestCartRequest(
        "/api/guest/cart/csrf-token",
      );
      if (!csrf_token) throw new Error("Could not initialize cart security.");

      await guestCartRequest("/api/guest/cart/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf_token,
        },
        body: JSON.stringify({
          variant_id: selectedVariant.id,
          quantity,
          notes: notes.trim() || null,
        }),
      });

      setCartMessage("Added to your cart!");
      // The navbar can subscribe to this event once we implement its counter.
      window.dispatchEvent(new Event("sweetbyandre:cart-updated"));
    } catch (err) {
      setCartError(err.message || "Could not add the item to your cart.");
    } finally {
      setAddingToCart(false);
    }
  }

  if (loading) {
    return <ProductDetailSkeleton />;
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
  const madeToOrder = product.inventory_mode === "made_to_order";
  const inStock =
    Boolean(selectedVariant) &&
    (madeToOrder || Number(selectedVariant.stock) > 0);
  const maxQuantity = inStock
    ? madeToOrder
      ? Number.MAX_SAFE_INTEGER
      : Math.floor(Number(selectedVariant.stock))
    : 0;
  const subtotal = selectedVariant
    ? Number(selectedVariant.price) * quantity
    : 0;
  const description = product.description ?? "";
  const hasLongDescription = description.length > 170;
  const descriptionPreview = hasLongDescription
    ? `${description
        .slice(0, 170)
        .replace(/\s+\S*$/, "")
        .trimEnd()}…`
    : description;

  return (
    <main className="min-h-screen bg-[#FAF7F5] px-4 py-6 sm:px-6 lg:py-8">
      <div className="mx-auto max-w-5xl">
        <a
          href="#catalog"
          className="mb-4 inline-flex min-h-11 items-center text-sm font-medium text-[#B76473] hover:underline"
        >
          Back to our menu
        </a>

        <div className="grid items-start gap-7 lg:grid-cols-2 lg:gap-10">
          <section
            aria-label="Product photos"
            className="mx-auto w-full max-w-md lg:sticky lg:top-6"
          >
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
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => setSelectedImage(index)}
                    aria-label={`View product image ${index + 1}`}
                    aria-pressed={selectedImage === index}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 ${
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

          <section aria-label="Customize your dessert" className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#B76473]">
              {product.category_name}
            </p>
            <h1 className="mt-2 break-words font-serif text-3xl text-[#282323] sm:text-4xl">
              {product.name}
            </h1>
            <p className="mt-3 text-2xl font-semibold text-[#282323]">
              {selectedVariant
                ? formatPrice(selectedVariant.price)
                : "Currently unavailable"}
            </p>
            <p
              id="product-description"
              className="mt-3 whitespace-pre-line text-sm leading-6 text-[#796D6A]"
            >
              {descriptionExpanded ? description : descriptionPreview}
            </p>
            {hasLongDescription && (
              <button
                type="button"
                aria-expanded={descriptionExpanded}
                aria-controls="product-description"
                onClick={() => setDescriptionExpanded((expanded) => !expanded)}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-[#9E4F60] underline"
              >
                {descriptionExpanded ? "Show less" : "Read full description"}
              </button>
            )}

            {optionGroups.length > 0 && (
              <div className="mt-5 grid gap-4 border-t border-[#E7DCD9] pt-5 sm:grid-cols-2">
                {optionGroups.map((group) => (
                  <div key={group.id}>
                    <p className="mb-2 text-sm font-semibold text-[#282323]">
                      {group.name}
                    </p>
                    <MinimalSelect
                      label={group.name}
                      value={selectedValues[group.id] ?? ""}
                      onChange={(nextValue) => chooseValue(group.id, nextValue)}
                      options={group.values.map((v) => ({
                        value: v.id,
                        label: v.label,
                        disabled: !valueIsSelectable(group.id, v.id),
                      }))}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 border-t border-[#E7DCD9] pt-4">
              <p
                className={`text-sm font-semibold ${inStock ? "text-green-700" : "text-[#A29A97]"}`}
              >
                {inStock
                  ? madeToOrder
                    ? "Made to order · date availability checked at checkout"
                    : `Available (${maxQuantity} in stock)`
                  : "Currently unavailable"}
              </p>
              <details className="mt-2 text-sm">
                <summary className="min-h-11 content-center font-semibold text-[#796D6A]">
                  Special instructions (optional)
                </summary>
                <label htmlFor="special-instructions" className="sr-only">
                  Special instructions
                </label>
                <textarea
                  id="special-instructions"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Any special requests for your dessert?"
                  className="mt-2 w-full resize-y rounded-2xl border border-[#E7DCD9] bg-white p-3 text-base focus:border-[#B76473]"
                />
              </details>

              <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#282323]">
                    Quantity
                  </p>
                  <div className="mt-2 flex items-center gap-4">
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
                <div className="text-right">
                  <span className="block text-xs text-[#796D6A]">Subtotal</span>
                  <span
                    aria-live="polite"
                    className="mt-1 block text-xl font-semibold text-[#282323]"
                  >
                    {selectedVariant ? formatPrice(subtotal) : "—"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={!inStock || addingToCart}
                className="mt-5 min-h-12 w-full rounded-full bg-[#B76473] px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {!inStock
                  ? "Out of Stock"
                  : addingToCart
                    ? "Adding to Cart..."
                    : "Add to Cart"}
              </button>
              {cartMessage && (
                <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-4">
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-sm text-green-800"
                  >
                    {cartMessage}
                  </p>
                  <a
                    href="#cart"
                    className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-[#9E4F60] underline"
                  >
                    View cart &amp; continue
                  </a>
                </div>
              )}
              {cartError && (
                <p role="alert" className="mt-3 text-sm text-red-700">
                  {cartError}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
