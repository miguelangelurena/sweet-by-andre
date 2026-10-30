import { useEffect, useState } from "react";
import {
  createGuestPendingOrder,
  ensureGuestCart,
  getGuestCart,
  startGuestStripeCheckout,
} from "../services/api";

const money = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value ?? 0));

const fields = [
  { name: "shipping_name", label: "Full name", autoComplete: "name" },
  { name: "customer_email", label: "Email address", type: "email", autoComplete: "email" },
  { name: "customer_phone", label: "Phone number", type: "tel", autoComplete: "tel" },
  { name: "shipping_street", label: "Street name", autoComplete: "address-line1" },
  { name: "shipping_street_number", label: "Street number" },
  { name: "shipping_unit", label: "Apartment / unit (optional)", required: false, autoComplete: "address-line2" },
  { name: "shipping_city", label: "City", autoComplete: "address-level2" },
  { name: "shipping_state", label: "State", autoComplete: "address-level1" },
  { name: "shipping_zip_code", label: "ZIP code", autoComplete: "postal-code" },
];

const initialForm = {
  shipping_name: "", customer_email: "", customer_phone: "",
  shipping_street: "", shipping_street_number: "", shipping_unit: "",
  shipping_city: "", shipping_state: "TX", shipping_zip_code: "",
  delivery_instructions: "", note: "", delivery_date: "", sms_opt_in: false,
};

function minDeliveryLocal() {
  // Buffer avoids being rejected because the server validates a rolling 48h window.
  const date = new Date(Date.now() + 49 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

const ORDER_REQUEST_KEY = "sba:pending-order-request:v1";

function readSavedRequest() {
  try {
    return JSON.parse(sessionStorage.getItem(ORDER_REQUEST_KEY) || "null");
  } catch { return null; }
}

export default function Checkout({ onBack }) {
  const [form, setForm] = useState(initialForm);
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const paymentsEnabled = import.meta.env.VITE_ENABLE_STRIPE_CHECKOUT === "true";
  const [order, setOrder] = useState(() => readSavedRequest()?.order ?? null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await ensureGuestCart();
        const data = await getGuestCart();
        if (active) setCart(data.cart);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const items = cart?.items ?? [];
  const ready = items.length > 0 && !cart?.has_price_changes &&
    !cart?.has_unavailable_items && items.every((item) => item.is_available);

  function update(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting || order) return;
    setError("");
    setSubmitting(true);

    try {
      // Refresh availability immediately before generating an order.
      const fresh = await getGuestCart();
      const freshItems = fresh.cart?.items ?? [];
      if (!freshItems.length || fresh.cart?.has_price_changes ||
          fresh.cart?.has_unavailable_items ||
          freshItems.some((item) => !item.is_available)) {
        setCart(fresh.cart);
        throw new Error("Your cart needs review before creating an order.");
      }
      const deliveryDate = new Date(form.delivery_date);
      if (!Number.isFinite(deliveryDate.getTime()) ||
          deliveryDate.getTime() < Date.now() + 48 * 60 * 60 * 1000) {
        throw new Error("Choose a delivery date at least 48 hours from now.");
      }
      const payload = {
        ...form,
        delivery_date: deliveryDate.toISOString(),
      };
      // Persist the same request ID and payload before sending it. A network
      // timeout or refresh can then retry without creating a second order.
      const saved = readSavedRequest();
      let request;
      if (saved?.order) {
        setOrder(saved.order);
        return;
      } else if (saved?.key && saved?.payload) {
        request = saved;
        if (JSON.stringify(saved.payload) !== JSON.stringify(payload)) {
          throw new Error("A previous order submission is unresolved. Restore the original details before retrying, or contact the bakery.");
        }
      } else {
        request = { key: crypto.randomUUID(), payload };
        sessionStorage.setItem(ORDER_REQUEST_KEY, JSON.stringify(request));
      }
      const response = await createGuestPendingOrder(request.payload, request.key);
      if (!response?.order?.id) throw new Error("The server did not return an order ID.");
      sessionStorage.setItem(ORDER_REQUEST_KEY,
        JSON.stringify({ ...request, order: response.order }));
      setOrder(response.order);
    } catch (err) {
      setError(err.message || "Could not create the order.");
    } finally {
      setSubmitting(false);
    }
  }

  async function proceedToStripe() {
    if (!order?.id || !paymentsEnabled || paymentBusy) return;
    setPaymentError("");
    setPaymentBusy(true);
    try {
      const result = await startGuestStripeCheckout(order.id);
      const url = new URL(result.checkoutUrl);
      if (result.status !== "SUCCESS" || url.protocol !== "https:" ||
          url.hostname !== "checkout.stripe.com") {
        throw new Error("Invalid Stripe Checkout destination. No redirect was performed.");
      }
      window.location.assign(url.href);
    } catch (err) {
      setPaymentError(err.message || "Could not start payment.");
      setPaymentBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#FAF7F5] px-4 py-10 text-[#282323] sm:px-6 lg:py-16">
      <div className="mx-auto max-w-5xl">
        <button type="button" onClick={onBack} className="text-sm font-semibold text-[#B76473] hover:underline">
          Back to cart
        </button>
        <h1 className="mb-3 mt-7 font-serif text-4xl sm:text-5xl">Delivery details</h1>
        <p className="mb-8 text-sm text-[#796D6A]">
          {paymentsEnabled
            ? "Prepare your order. Full payment is collected through Stripe Checkout."
            : "Prepare your order. Online payments are not available yet; no charge will be made."}
        </p>

        {error && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
        {loading ? <p>Loading your cart...</p> : order ? (
          <section className="rounded-3xl border border-[#E7DCD9] bg-white p-8">
            <h2 className="font-serif text-3xl">Pending order created</h2>
            <p className="mt-4 text-[#796D6A]">Your order has been saved, but it has not been paid or confirmed by the bakery.</p>
            <p className="mt-4 break-all text-sm"><strong>Order ID:</strong> {order.id}</p>
            <p className="mt-2 text-lg font-semibold">Total: {money(order.total)}</p>
            <div className="mt-7 rounded-2xl border border-[#E7DCD9] bg-[#FAF7F5] p-5">
              <h3 className="font-serif text-2xl">Payment</h3>
              <p className="mt-2 text-sm text-[#796D6A]">Full payment: {money(order.total)} (100%). A pending order is not a paid order.</p>
              {paymentError && <p role="alert" className="mt-3 text-sm text-red-700">{paymentError}</p>}
              <button type="button" onClick={proceedToStripe}
                disabled={!paymentsEnabled || paymentBusy}
                className="mt-4 w-full rounded-full bg-[#B76473] px-6 py-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55">
                {paymentBusy ? "Preparing secure checkout..." : "Proceed to secure payment"}
              </button>
              <p className="mt-3 text-xs leading-5 text-[#796D6A]">
                {paymentsEnabled
                  ? "Test mode only: activate the backend only with an approved Stripe test account. Do not enter real card details."
                  : "Online payments are disabled while the bakery's Stripe account is being configured. No charge will be made."}
              </p>
            </div>
            <button type="button" onClick={onBack} className="mt-6 rounded-full border border-[#B76473] px-6 py-3 font-semibold text-[#B76473]">Back to cart</button>
          </section>
        ) : !ready ? (
          <section className="rounded-3xl bg-white p-8">
            <p className="text-[#796D6A]">Your cart is empty or has items that require review before checkout.</p>
            <button type="button" onClick={onBack} className="mt-5 rounded-full bg-[#B76473] px-6 py-3 font-semibold text-white">Review cart</button>
          </section>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
            <form id="delivery-form" onSubmit={submit} className="rounded-3xl border border-[#E7DCD9] bg-white p-6 sm:p-8">
              <h2 className="mb-6 font-serif text-2xl">Contact and delivery</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {fields.map((field) => (
                  <label key={field.name} className="block text-sm font-medium">
                    <span className="mb-1 block">{field.label}</span>
                    <input
                      name={field.name}
                      type={field.type || "text"}
                      autoComplete={field.autoComplete}
                      value={form[field.name]}
                      onChange={update}
                      required={field.required !== false}
                      maxLength={255}
                      disabled={submitting}
                      className="w-full rounded-xl border border-[#E7DCD9] px-3 py-3 outline-offset-2 focus:outline-[#B76473]"
                    />
                  </label>
                ))}
              </div>
              <label className="mt-5 block text-sm font-medium">
                <span className="mb-1 block">Requested delivery date and time</span>
                <input type="datetime-local" name="delivery_date" value={form.delivery_date}
                  onChange={update} min={minDeliveryLocal()} required disabled={submitting}
                  className="w-full rounded-xl border border-[#E7DCD9] px-3 py-3" />
                <span className="mt-1 block text-xs font-normal text-[#796D6A]">At least 48 hours in advance. Availability is subject to bakery confirmation.</span>
              </label>
              {[
                ["delivery_instructions", "Delivery instructions (optional)"],
                ["note", "Additional order note (optional)"],
              ].map(([name, label]) => (
                <label key={name} className="mt-5 block text-sm font-medium">
                  <span className="mb-1 block">{label}</span>
                  <textarea name={name} value={form[name]} onChange={update} maxLength={2000}
                    disabled={submitting} rows={3}
                    className="w-full rounded-xl border border-[#E7DCD9] px-3 py-3" />
                </label>
              ))}
              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-[#E7DCD9] bg-[#FFF9F8] p-4 text-sm leading-6">
                <input type="checkbox" name="sms_opt_in" checked={form.sms_opt_in} onChange={update}
                  disabled={submitting} className="mt-1 h-4 w-4 shrink-0 accent-[#B76473]" />
                <span><strong>Optional SMS order updates.</strong> I agree to receive automated transactional text messages about this order from Sweet by André. Message and data rates may apply. Consent is not required to purchase.</span>
              </label>
              <button type="submit" disabled={submitting}
                className="mt-7 w-full rounded-full bg-[#B76473] px-6 py-4 font-semibold text-white hover:bg-[#A65363] disabled:opacity-50">
                {submitting ? "Saving pending order..." : "Create pending order (no payment)"}
              </button>
            </form>
            <aside className="rounded-3xl border border-[#E7DCD9] bg-white p-6">
              <h2 className="font-serif text-2xl">Order summary</h2>
              {items.map((item) => (
                <div key={item.id} className="mt-4 flex justify-between gap-3 text-sm">
                  <span>{item.product_name} × {item.quantity}</span>
                  <span className="whitespace-nowrap">{money(item.current_subtotal)}</span>
                </div>
              ))}
              <div className="mt-5 flex justify-between border-t border-[#E7DCD9] pt-4 font-semibold">
                <span>Estimated subtotal</span><span>{money(cart?.current_total)}</span>
              </div>
              <p className="mt-4 text-xs leading-5 text-[#796D6A]">
                Taxes and delivery are not yet calculated. These are provisional development values, not a final customer quote.
              </p>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
