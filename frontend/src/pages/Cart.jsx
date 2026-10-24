import { useCallback, useEffect, useState } from "react";

const API = "/api"; // Uses the existing Vite /api proxy in development.
const formatMoney = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value ?? 0),
  );

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(
      "Cannot connect to the shop. Please check that the backend is running.",
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || `Request failed (${response.status})`);
  }
  return payload;
}

async function ensureGuestCart() {
  await request("/guest/cart", { method: "POST" });
}

async function getCsrfToken() {
  const data = await request("/guest/cart/csrf-token");
  if (!data.csrf_token) throw new Error("Could not obtain a security token.");
  return data.csrf_token;
}

export default function Cart({ onContinueShopping }) {
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyItemId, setBusyItemId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadCart = useCallback(async () => {
    const data = await request("/guest/cart");
    setCart(data.cart);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function initialize() {
      try {
        // Creates a guest cart if no cookie exists, or returns the existing one.
        await ensureGuestCart();
        const data = await request("/guest/cart");
        if (mounted) setCart(data.cart);
      } catch (err) {
        if (mounted) setError(err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    initialize();
    return () => {
      mounted = false;
    };
  }, []);

  async function changeItem(id, method, quantity) {
    setBusyItemId(id);
    setError("");
    setNotice("");

    try {
      const csrf = await getCsrfToken();

      await request(`/guest/cart/items/${id}`, {
        method,
        headers: { "X-CSRF-Token": csrf },
        ...(method === "PATCH" ? { body: JSON.stringify({ quantity }) } : {}),
      });

      // Refresh the cart after the operation succeeds.
      await loadCart();

      // Notify the Header that the cart has changed.
      window.dispatchEvent(new Event("sweetbyandre:cart-updated"));

      setNotice(
        method === "DELETE" ? "Item removed from your cart." : "Cart updated.",
      );
    } catch (err) {
      setError(err.message);

      // Refresh values after a stock conflict or stale item.
      try {
        await loadCart();
      } catch {
        // Keep the original error.
      }
    } finally {
      setBusyItemId(null);
    }
  }

  const items = cart?.items ?? [];
  const anyBusy = busyItemId !== null;
  const totalQuantity = items.reduce(
    (sum, item) => sum + Number(item.quantity),
    0,
  );

  return (
    <main className="min-h-screen bg-[#FAF7F5] px-4 py-10 text-[#282323] sm:px-6 lg:py-16">
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          onClick={() => onContinueShopping?.()}
          disabled={!onContinueShopping}
          className="text-sm font-medium text-[#B76473] hover:underline disabled:cursor-default disabled:opacity-50"
        >
          ← Continue shopping
        </button>
        <div className="mb-9 mt-7 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-serif text-4xl sm:text-5xl">Your Cart</h1>
          {cart && (
            <p className="text-sm text-[#796D6A]">
              {totalQuantity} {totalQuantity === 1 ? "item" : "items"}
            </p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800"
          >
            {notice}
          </p>
        )}

        {loading ? (
          <p className="py-12 text-[#796D6A]">Loading your cart...</p>
        ) : !cart ? (
          <div className="rounded-3xl bg-white p-8 text-[#796D6A]">
            We couldn't load your cart. Please refresh the page.
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-[#E7DCD9] bg-white px-6 py-16 text-center">
            <h2 className="font-serif text-2xl text-[#282323]">
              Your cart is empty
            </h2>
            <p className="mt-3 text-[#796D6A]">
              Your favorite desserts are waiting for you.
            </p>
            {onContinueShopping && (
              <button
                type="button"
                onClick={onContinueShopping}
                className="mt-7 rounded-full bg-[#B76473] px-7 py-3 font-semibold text-white hover:bg-[#A65363]"
              >
                Browse desserts
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
            <section aria-label="Cart items" className="space-y-4">
              {items.map((item) => {
                const busy = anyBusy;
                const itemStock = Number(item.variant_stock);
                const unavailable = !item.is_available;
                return (
                  <article
                    key={item.id}
                    className="rounded-3xl border border-[#E7DCD9] bg-white p-5 sm:p-6"
                  >
                    <div className="flex flex-wrap justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h2 className="font-serif text-2xl">
                          {item.product_name}
                        </h2>
                        {(item.options ?? []).map((option, index) => (
                          <p
                            key={`${option.option_name}-${index}`}
                            className="mt-2 text-sm text-[#796D6A]"
                          >
                            {option.option_name}: {option.value}
                          </p>
                        ))}
                        {item.notes && (
                          <p className="mt-2 text-sm text-[#796D6A]">
                            Special instructions: {item.notes}
                          </p>
                        )}
                        <p className="mt-3 text-sm">
                          {formatMoney(item.current_unit_price)} each
                        </p>
                        {item.price_changed && (
                          <p
                            className="mt-2 text-sm text-amber-800"
                            role="status"
                          >
                            Price changed from {formatMoney(item.unit_price)} to{" "}
                            {formatMoney(item.current_unit_price)}. Review
                            before checkout.
                          </p>
                        )}
                        {unavailable && (
                          <p className="mt-2 text-sm font-medium text-red-700">
                            This item needs review (availability or stock
                            changed).
                          </p>
                        )}
                      </div>
                      <p className="text-xl font-semibold">
                        {formatMoney(item.current_subtotal)}
                      </p>
                    </div>
                    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[#E7DCD9] pt-4">
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          aria-label={`Decrease ${item.product_name} quantity`}
                          disabled={busy || Number(item.quantity) <= 1}
                          onClick={() =>
                            changeItem(
                              item.id,
                              "PATCH",
                              Number(item.quantity) - 1,
                            )
                          }
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-[#E7DCD9] disabled:opacity-40"
                        >
                          −
                        </button>
                        <span className="min-w-6 text-center font-semibold">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`Increase ${item.product_name} quantity`}
                          disabled={
                            busy ||
                            unavailable ||
                            Number(item.quantity) >= itemStock
                          }
                          onClick={() =>
                            changeItem(
                              item.id,
                              "PATCH",
                              Number(item.quantity) + 1,
                            )
                          }
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-[#E7DCD9] disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => changeItem(item.id, "DELETE")}
                        className="text-sm font-semibold text-[#B76473] hover:underline disabled:opacity-40"
                      >
                        {busyItemId === item.id ? "Updating..." : "Remove"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
            <aside className="rounded-3xl border border-[#E7DCD9] bg-white p-6">
              <h2 className="font-serif text-2xl">Order Summary</h2>
              <div className="mt-6 flex items-center justify-between text-sm">
                <span className="text-[#796D6A]">Subtotal</span>
                <span className="font-semibold">
                  {formatMoney(cart.current_total)}
                </span>
              </div>
              <p className="mt-4 text-xs leading-5 text-[#796D6A]">
                Taxes and delivery charges are calculated at checkout. Prices
                and availability are confirmed before payment.
              </p>
              {cart.has_price_changes && (
                <p className="mt-4 text-sm text-amber-800">
                  Some prices have changed. Price acceptance will be handled in
                  the checkout flow.
                </p>
              )}
              {cart.has_unavailable_items && (
                <p className="mt-4 text-sm text-red-700">
                  Some items are unavailable. Please review your cart.
                </p>
              )}
              <button
                type="button"
                disabled
                title="Checkout will be enabled after order and payment integration"
                className="mt-7 w-full cursor-not-allowed rounded-full bg-[#B76473] px-6 py-4 font-semibold text-white opacity-55"
              >
                Checkout — Coming Soon
              </button>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
