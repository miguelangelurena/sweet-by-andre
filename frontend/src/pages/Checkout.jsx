import { useEffect, useRef, useState } from "react";
import FulfillmentFields from "../components/checkout/FulfillmentFields";
import {
  deliveryAddressFields,
  fulfillmentAvailability,
  formatServiceDate,
  formatServiceTime,
} from "../utils/fulfillment";
import {
  apiRequest,
  createGuestPendingOrder,
  ensureGuestCart,
  getGuestCart,
  startGuestStripeCheckout,
  getDeliveryOptions,
  quoteGuestDelivery,
  getProductionOptions,
} from "../services/api";

const money = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value ?? 0),
  );
const contactFields = [
  { name: "shipping_name", label: "Full name", autoComplete: "name" },
  {
    name: "customer_email",
    label: "Email address",
    type: "email",
    autoComplete: "email",
  },
  {
    name: "customer_phone",
    label: "Phone number",
    type: "tel",
    autoComplete: "tel",
  },
];
const addressFields = [
  {
    name: "shipping_street_number",
    label: "Street number",
    placeholder: "1234",
  },
  {
    name: "shipping_street",
    label: "Street name",
    placeholder: "Example Drive",
    autoComplete: "address-line1",
  },
  {
    name: "shipping_unit",
    label: "Apartment / unit (optional)",
    required: false,
    autoComplete: "address-line2",
  },
  { name: "shipping_city", label: "City", autoComplete: "address-level2" },
  {
    name: "shipping_state",
    label: "State (Texas)",
    autoComplete: "address-level1",
    pattern: "[Tt][Xx]",
    maxLength: 2,
  },
  {
    name: "shipping_zip_code",
    label: "ZIP code",
    autoComplete: "postal-code",
    inputMode: "numeric",
    pattern: "[0-9]{5}(-[0-9]{4})?",
    maxLength: 10,
  },
];
const initialForm = {
  shipping_name: "",
  customer_email: "",
  customer_phone: "",
  shipping_street: "",
  shipping_street_number: "",
  shipping_unit: "",
  shipping_city: "",
  shipping_state: "TX",
  shipping_zip_code: "",
  delivery_instructions: "",
  note: "",
  sms_opt_in: false,
  fulfillment_method: "pickup",
  fulfillment_date: "",
  fulfillment_time: "",
};
const ORDER_REQUEST_KEY = "sba:pending-order-request:v1";
function readSavedRequest() {
  try {
    return JSON.parse(sessionStorage.getItem(ORDER_REQUEST_KEY) || "null");
  } catch {
    return null;
  }
}

function CustomerFields({ fields, form, update }) {
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <label key={field.name} className="min-w-0 text-sm font-medium">
          <span className="mb-2 block">{field.label}</span>
          <input
            name={field.name}
            type={field.type || "text"}
            autoComplete={field.autoComplete}
            inputMode={field.inputMode}
            pattern={field.pattern}
            placeholder={field.placeholder}
            value={form[field.name]}
            onChange={update}
            required={field.required !== false}
            maxLength={field.maxLength ?? 255}
            className="min-h-12 min-w-0 w-full rounded-xl border border-[#E7DCD9] bg-white px-3 py-3 text-base focus:outline-[#B76473]"
          />
        </label>
      ))}
    </div>
  );
}

export default function Checkout({ onBack }) {
  const [form, setForm] = useState(() => ({
    ...initialForm,
    ...readSavedRequest()?.payload,
  }));
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [deliveryHoldExpired, setDeliveryHoldExpired] = useState(false);
  const [deliveryOptions, setDeliveryOptions] = useState(null);
  const [productionOptions, setProductionOptions] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [order, setOrder] = useState(() => readSavedRequest()?.order ?? null);
  const [orderVerified, setOrderVerified] = useState(false);
  const errorRef = useRef(null);
  const [unresolved, setUnresolved] = useState(() => {
    const saved = readSavedRequest();
    return Boolean(saved?.key && saved?.payload && !saved?.order);
  });
  const paymentsEnabled =
    import.meta.env.VITE_ENABLE_STRIPE_CHECKOUT === "true";

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const orderId = order?.id;
  useEffect(() => {
    if (!orderId) return;
    let active = true;
    apiRequest(`/guest/orders/${encodeURIComponent(orderId)}/status`)
      .then((response) => {
        if (!active) return;
        setOrder((current) => ({ ...current, ...response.order }));
        setOrderVerified(true);
      })
      .catch(() => {
        if (active) {
          setOrderVerified(false);
          setError(
            "We could not check the latest order status. Please reload before continuing to payment.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await ensureGuestCart();
        const [data, delivery, production] = await Promise.all([
          getGuestCart(),
          getDeliveryOptions(),
          getProductionOptions(),
        ]);
        if (active) {
          setCart(data.cart);
          setDeliveryOptions(delivery.options);
          setProductionOptions(production.options);
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!quote) return;
    const remaining = new Date(quote.expires_at).getTime() - Date.now();
    const timer = setTimeout(
      () => {
        setQuote(null);
        setQuoteError(
          "Your delivery estimate expired. Please check the delivery fee again.",
        );
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [quote]);

  const items = cart?.items ?? [];
  const requiredProductionPoints = items.reduce(
    (sum, item) =>
      sum +
      (item.inventory_mode === "made_to_order"
        ? Number(item.quantity) * Number(item.production_points)
        : 0),
    0,
  );
  const schedule = fulfillmentAvailability(
    form,
    deliveryOptions,
    productionOptions,
    requiredProductionPoints,
  );
  const delivery = form.fulfillment_method === "delivery";
  const subtotalCents = Math.round(Number(cart?.current_total ?? 0) * 100);
  const belowMinimum =
    deliveryOptions &&
    (delivery || deliveryOptions.minimum_scope === "all") &&
    subtotalCents < deliveryOptions.minimum_subtotal_cents;
  const ready =
    items.length > 0 &&
    !cart?.has_price_changes &&
    !cart?.has_unavailable_items &&
    items.every((item) => item.is_available);
  const missingStep = !deliveryOptions
    ? "Pickup and delivery options could not be loaded. Please reload to try again."
    : delivery && !deliveryOptions.delivery_available
      ? "Delivery is currently unavailable. Please choose pickup."
      : belowMinimum
        ? delivery && deliveryOptions.minimum_scope !== "all"
          ? "Add more desserts to meet the minimum purchase, or choose pickup."
          : "Add more desserts to meet the minimum purchase."
        : !form.fulfillment_date
          ? "Choose your pickup or delivery date."
          : schedule.dateError ||
            schedule.timeError ||
            (!form.fulfillment_time ? "Choose your preferred time." : "") ||
            (delivery && !quote
              ? "Enter your address and check the delivery fee."
              : "");
  const estimate =
    delivery && !quote
      ? null
      : (subtotalCents + (delivery ? quote.fee_cents : 0)) / 100;

  function update(event) {
    if (quoteBusy || submitting) return;
    const { name, value, type, checked } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
      ...(["fulfillment_date", "fulfillment_method"].includes(name)
        ? { fulfillment_time: "" }
        : {}),
    }));
    if (
      [
        ...deliveryAddressFields,
        "shipping_unit",
        "fulfillment_method",
      ].includes(name)
    ) {
      setQuote(null);
      setQuoteError("");
    }
  }

  async function calculateQuote() {
    if (quoteBusy || submitting) return;
    setQuoteBusy(true);
    setQuoteError("");
    setQuote(null);
    try {
      setQuote((await quoteGuestDelivery(form)).quote);
    } catch (err) {
      setQuoteError(err.message);
    } finally {
      setQuoteBusy(false);
    }
  }

  async function completeRequest(request) {
    const response = await createGuestPendingOrder(
      request.payload,
      request.key,
    );
    if (!response?.order?.id)
      throw new Error("The server did not return an order ID.");
    sessionStorage.setItem(
      ORDER_REQUEST_KEY,
      JSON.stringify({ ...request, order: response.order }),
    );
    setOrder(response.order);
    setOrderVerified(true);
    setUnresolved(false);
    window.dispatchEvent(new Event("sweetbyandre:cart-updated"));
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function reportOrderError(err) {
    // Keep unknown outcomes recoverable with the original payload and key.
    // A validation rejection is safe to correct; it did not create an order.
    if (
      (err.status === 400 ||
        err.status === 422 ||
        err.code?.startsWith("DELIVERY_") ||
        err.code?.startsWith("PRODUCTION_")) &&
      !readSavedRequest()?.order
    ) {
      sessionStorage.removeItem(ORDER_REQUEST_KEY);
      setUnresolved(false);
      if (err.code?.startsWith("DELIVERY_")) setQuote(null);
    } else {
      const saved = readSavedRequest();
      setUnresolved(Boolean(saved?.key && saved?.payload && !saved?.order));
    }
    if (err.code?.startsWith("PRODUCTION_")) {
      const fresh = await getProductionOptions().catch(() => null);
      if (fresh) setProductionOptions(fresh.options);
    }
    setError(err.message || "Could not save your order. Please try again.");
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting || quoteBusy || order) return;
    setError("");
    setSubmitting(true);
    try {
      if (missingStep) throw new Error(missingStep);
      const fresh = await getGuestCart();
      const freshItems = fresh.cart?.items ?? [];
      if (
        !freshItems.length ||
        fresh.cart?.has_price_changes ||
        fresh.cart?.has_unavailable_items ||
        freshItems.some((item) => !item.is_available)
      ) {
        setCart(fresh.cart);
        throw new Error(
          "Your cart has changed. Please return to the cart to review it.",
        );
      }
      if (
        delivery &&
        (!quote || new Date(quote.expires_at).getTime() <= Date.now())
      )
        throw new Error(
          "Please check the delivery fee again before saving your order.",
        );
      const payload = {
        ...form,
        delivery_quote_id: delivery ? quote.id : null,
      };
      const saved = readSavedRequest();
      if (saved?.order) {
        setOrder(saved.order);
        return;
      }
      let request = saved?.key && saved?.payload ? saved : null;
      if (
        request &&
        JSON.stringify(request.payload) !== JSON.stringify(payload)
      )
        throw new Error(
          "Please check your previous submission before starting another order.",
        );
      if (!request) {
        request = { key: crypto.randomUUID(), payload };
        sessionStorage.setItem(ORDER_REQUEST_KEY, JSON.stringify(request));
      }
      await completeRequest(request);
    } catch (err) {
      await reportOrderError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function retrySubmission() {
    const saved = readSavedRequest();
    if (submitting || !saved?.key || !saved?.payload) return;
    setSubmitting(true);
    setError("");
    try {
      await completeRequest(saved);
    } catch (err) {
      await reportOrderError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function proceedToStripe() {
    if (
      !order?.id ||
      !orderVerified ||
      order.payment_status === "paid" ||
      !paymentsEnabled ||
      paymentBusy
    )
      return;
    setPaymentError("");
    setDeliveryHoldExpired(false);
    setPaymentBusy(true);
    try {
      const result = await startGuestStripeCheckout(order.id);
      const url = new URL(result.checkoutUrl);
      if (
        result.status !== "SUCCESS" ||
        url.protocol !== "https:" ||
        url.hostname !== "checkout.stripe.com"
      )
        throw new Error("Could not open secure payment. Please try again.");
      window.location.assign(url.href);
    } catch (err) {
      setDeliveryHoldExpired(
        ["DELIVERY_HOLD_EXPIRED", "PRODUCTION_HOLD_EXPIRED"].includes(err.code),
      );
      setPaymentError(err.message || "Could not start payment.");
      setPaymentBusy(false);
    }
  }

  const savedPayload = readSavedRequest()?.payload;
  const paid = orderVerified && order?.payment_status === "paid";
  const closed =
    ["cancelled", "refund_pending", "completed"].includes(
      order?.order_status,
    ) || order?.payment_status === "refunded";
  const orderStatusLabel =
    {
      pending: "Awaiting bakery acceptance",
      confirmed: "Accepted",
      preparing: "Being prepared",
      ready: "Ready",
      completed: "Completed",
      cancelled: "Cancelled",
      refund_pending: "Refund in progress",
    }[order?.order_status] || "Awaiting bakery acceptance";
  const appointment = order?.fulfillment_at
    ? new Date(order.fulfillment_at)
    : null;
  const orderDate =
    appointment && !Number.isNaN(appointment.getTime())
      ? new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "America/Chicago",
        }).format(appointment)
      : savedPayload?.fulfillment_date && savedPayload?.fulfillment_time
        ? `${formatServiceDate(savedPayload.fulfillment_date)} at ${formatServiceTime(savedPayload.fulfillment_time)}`
        : null;

  return (
    <main className="min-h-screen bg-[#FAF7F5] px-4 py-6 text-[#282323] sm:px-6 sm:py-10 lg:py-16">
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 text-sm font-semibold text-[#B76473] hover:underline"
        >
          ← Back to cart
        </button>
        <ol
          aria-label="Checkout progress"
          className="mt-2 flex items-center gap-2 text-xs text-[#796D6A] sm:gap-4"
        >
          <li>1. Cart</li>
          <li aria-hidden="true">/</li>
          <li
            aria-current={!order ? "step" : undefined}
            className={!order ? "font-semibold text-[#9E4F60]" : ""}
          >
            2. Details
          </li>
          <li aria-hidden="true">/</li>
          <li
            aria-current={order ? "step" : undefined}
            className={order ? "font-semibold text-[#9E4F60]" : ""}
          >
            3. {paymentsEnabled ? "Payment" : "Order request"}
          </li>
        </ol>
        <h1 className="mt-5 font-serif text-3xl sm:text-5xl">
          {order ? "Your order request" : "Checkout"}
        </h1>
        <p className="mt-3 mb-6 max-w-xl text-sm leading-6 text-[#796D6A]">
          {order
            ? "Your order details are saved. See what happens next below."
            : "Choose pickup or delivery and review your details. No payment is taken on this page."}
        </p>
        {error && (
          <p
            role="alert"
            ref={errorRef}
            tabIndex={-1}
            className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"
          >
            {error}
          </p>
        )}

        {loading ? (
          <p role="status" className="py-8 text-sm text-[#796D6A]">
            Getting your cart and available dates ready...
          </p>
        ) : order ? (
          <section className="rounded-3xl border border-[#E7DCD9] bg-white p-5 sm:p-8">
            <span className="inline-block rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              {!orderVerified
                ? "Checking order status…"
                : paid
                  ? `Paid · ${orderStatusLabel.toLowerCase()}`
                  : closed
                    ? orderStatusLabel
                    : "Awaiting payment & bakery confirmation"}
            </span>
            <h2 className="mt-4 font-serif text-2xl sm:text-3xl">
              {paid
                ? "Payment received"
                : closed
                  ? "Your order status"
                  : "Order request saved"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#796D6A]">
              {!orderVerified
                ? "Checking the latest status of your saved order."
                : paid
                  ? `Your payment has been verified. ${order.order_status === "pending" ? "Andrea still needs to accept your order." : "See the bakery's current progress below."}`
                  : closed
                    ? "Contact Andrea if you have questions about this order."
                    : "Your order has been saved. It has not been paid or accepted by the bakery yet."}
            </p>
            <dl className="mt-5 space-y-3 text-sm">
              <div>
                <dt className="font-medium">Order number</dt>
                <dd className="mt-1 break-all text-[#796D6A]">{order.id}</dd>
              </div>
              <div>
                <dt className="font-medium">
                  {order.fulfillment_method === "delivery"
                    ? "Delivery"
                    : "Pickup"}
                </dt>
                <dd className="mt-1 text-[#796D6A]">
                  {orderDate
                    ? `${orderDate} · Houston time`
                    : "Contact the bakery to confirm your arrangements."}
                </dd>
              </div>
              {order.fulfillment_method === "pickup" && (
                <div className="rounded-xl bg-[#FAF7F5] p-3 text-[#796D6A]">
                  Your pickup time is a request. Andrea will coordinate the time
                  and location with you.
                </div>
              )}
              <div className="flex justify-between gap-3 border-t border-[#E7DCD9] pt-4 text-lg font-semibold">
                <dt>Order total</dt>
                <dd>{money(order.total)}</dd>
              </div>
              {order.fulfillment_method === "delivery" && (
                <div className="flex justify-between gap-3 text-[#796D6A]">
                  <dt>Delivery fee included</dt>
                  <dd>{money(order.shipping_cost)}</dd>
                </div>
              )}
            </dl>
            {paid || closed ? (
              <div className="mt-6 rounded-2xl bg-[#FAF7F5] p-4">
                <p className="text-sm font-semibold">{orderStatusLabel}</p>
                <a
                  href="mailto:sweetbyandre@gmail.com"
                  className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[#9E4F60] underline"
                >
                  Contact Andrea about this order
                </a>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-[#E7DCD9] bg-[#FAF7F5] p-4 sm:p-5">
                <h3 className="font-serif text-2xl">
                  {paymentsEnabled
                    ? "Next: secure payment"
                    : "What happens next?"}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#796D6A]">
                  {paymentsEnabled
                    ? `Continue to Stripe to pay the full order amount of ${money(order.total)}. Payment confirmation and bakery acceptance are separate steps.`
                    : "Online payments are currently unavailable. Contact Andrea with your order number to coordinate the next steps. Your request is not a confirmed booking."}
                </p>
                {paymentError && (
                  <p role="alert" className="mt-3 text-sm text-red-700">
                    {paymentError}
                  </p>
                )}
                {deliveryHoldExpired && (
                  <button
                    type="button"
                    className="mt-3 min-h-11 text-sm font-semibold text-[#9E4F60] underline"
                    onClick={() => {
                      setForm({
                        ...initialForm,
                        ...savedPayload,
                        fulfillment_time: "",
                      });
                      sessionStorage.removeItem(ORDER_REQUEST_KEY);
                      setOrder(null);
                      setOrderVerified(false);
                      setUnresolved(false);
                      setQuote(null);
                      setPaymentError("");
                      setDeliveryHoldExpired(false);
                    }}
                  >
                    Choose a new date and start a new order
                  </button>
                )}
                {paymentsEnabled ? (
                  <>
                    <button
                      type="button"
                      onClick={proceedToStripe}
                      disabled={
                        !orderVerified || paymentBusy || deliveryHoldExpired
                      }
                      className="mt-4 min-h-12 w-full rounded-full bg-[#B76473] px-5 py-4 font-semibold text-white disabled:opacity-55"
                    >
                      {paymentBusy
                        ? "Preparing secure payment..."
                        : "Proceed to secure payment"}
                    </button>
                    <p className="mt-3 text-xs leading-5 text-[#796D6A]">
                      Test payments only. Do not enter real card details.
                    </p>
                  </>
                ) : (
                  <a
                    href="mailto:sweetbyandre@gmail.com"
                    className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#B76473] px-5 py-3 text-sm font-semibold text-white"
                  >
                    Contact Andrea
                  </a>
                )}
              </div>
            )}
          </section>
        ) : unresolved ? (
          <section className="rounded-3xl border border-[#E7DCD9] bg-white p-5 sm:p-8">
            <h2 className="font-serif text-2xl">
              Let's check your last submission
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#796D6A]">
              We have your submitted details but could not confirm the response.
              Check that same request before creating another order.
            </p>
            <button
              type="button"
              disabled={submitting}
              onClick={retrySubmission}
              className="mt-5 min-h-12 w-full rounded-full bg-[#B76473] px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              {submitting
                ? "Checking your order..."
                : "Check previous submission"}
            </button>
            <a
              href="mailto:sweetbyandre@gmail.com"
              className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[#9E4F60] underline"
            >
              Contact the bakery for help
            </a>
          </section>
        ) : !ready ? (
          <section className="rounded-3xl border border-[#E7DCD9] bg-white p-5 sm:p-8">
            <h2 className="font-serif text-2xl">Let's review your cart</h2>
            <p className="mt-3 text-sm leading-6 text-[#796D6A]">
              Your cart is empty or some items have changed. Review the prices
              and availability before continuing.
            </p>
            <button
              type="button"
              onClick={onBack}
              className="mt-5 min-h-12 rounded-full bg-[#B76473] px-6 py-3 font-semibold text-white"
            >
              Review cart
            </button>
          </section>
        ) : (
          <form
            onSubmit={submit}
            className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start"
          >
            <fieldset
              disabled={submitting || quoteBusy}
              className="min-w-0 space-y-6 rounded-3xl border border-[#E7DCD9] bg-white p-4 sm:p-8"
            >
              <section aria-labelledby="contact-title">
                <h2 id="contact-title" className="font-serif text-2xl">
                  1. Your contact details
                </h2>
                <p className="mt-2 mb-4 text-sm leading-6 text-[#796D6A]">
                  So Andrea can reach you about your order. All fields are
                  required unless marked optional.
                </p>
                <CustomerFields
                  fields={contactFields}
                  form={form}
                  update={update}
                />
              </section>
              {deliveryOptions ? (
                <FulfillmentFields
                  form={form}
                  update={update}
                  options={deliveryOptions}
                  production={productionOptions}
                  requiredPoints={requiredProductionPoints}
                  quote={quote}
                  quoteBusy={quoteBusy}
                  quoteError={quoteError}
                  calculateQuote={calculateQuote}
                  subtotalCents={subtotalCents}
                >
                  <CustomerFields
                    fields={addressFields}
                    form={form}
                    update={update}
                  />
                  <details className="mt-4 text-sm">
                    <summary className="py-2 font-medium text-[#9E4F60]">
                      Delivery instructions (optional)
                    </summary>
                    <textarea
                      aria-label="Delivery instructions"
                      name="delivery_instructions"
                      value={form.delivery_instructions}
                      onChange={update}
                      maxLength={2000}
                      rows={3}
                      placeholder="Gate code, where to meet you, or other arrival instructions"
                      className="mt-2 w-full rounded-xl border border-[#E7DCD9] p-3 text-base"
                    />
                  </details>
                </FulfillmentFields>
              ) : (
                <p role="alert" className="text-sm text-red-700">
                  Could not load pickup and delivery options. Please reload to
                  try again.
                </p>
              )}
              <section
                aria-labelledby="extras-title"
                className="border-t border-[#E7DCD9] pt-6"
              >
                <h2 id="extras-title" className="font-serif text-2xl">
                  3. Anything else?
                </h2>
                <details className="mt-3 text-sm">
                  <summary className="py-2 font-medium text-[#9E4F60]">
                    Add an order note (optional)
                  </summary>
                  <textarea
                    aria-label="Additional order note"
                    name="note"
                    value={form.note}
                    onChange={update}
                    maxLength={2000}
                    rows={3}
                    placeholder="Tell us about your occasion or any special requests"
                    className="mt-2 w-full rounded-xl border border-[#E7DCD9] p-3 text-base"
                  />
                </details>
                <label className="mt-4 flex items-start gap-3 rounded-xl bg-[#FAF7F5] p-3 text-xs leading-5 text-[#796D6A]">
                  <input
                    type="checkbox"
                    name="sms_opt_in"
                    checked={form.sms_opt_in}
                    onChange={update}
                    className="mt-1 h-4 w-4 shrink-0 accent-[#B76473]"
                  />
                  <span>
                    <strong>Optional SMS order updates.</strong> I agree to
                    receive automated transactional text messages about this
                    order from Sweet by André. Message and data rates may apply.
                    Consent is not required to purchase.
                  </span>
                </label>
              </section>
            </fieldset>
            <aside
              className="min-w-0 rounded-3xl border border-[#E7DCD9] bg-white p-5 lg:sticky lg:top-6"
              aria-labelledby="summary-title"
            >
              <h2 id="summary-title" className="font-serif text-2xl">
                Review your order
              </h2>
              <a
                href="/#cart"
                className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-[#9E4F60] underline"
              >
                Edit cart
              </a>
              <ul className="space-y-4">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex min-w-0 justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0 break-words">
                      <span className="font-medium">
                        {item.product_name} × {item.quantity}
                      </span>
                      {(item.options ?? []).map((option, index) => (
                        <p key={index} className="mt-1 text-xs text-[#796D6A]">
                          {option.option_name}: {option.value}
                        </p>
                      ))}
                    </div>
                    <span className="shrink-0">
                      {money(item.current_subtotal)}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="mt-5 space-y-3 border-t border-[#E7DCD9] pt-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt>Desserts</dt>
                  <dd>{money(cart.current_total)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>{delivery ? "Delivery fee" : "Pickup"}</dt>
                  <dd>
                    {delivery
                      ? quote
                        ? money(quote.fee_cents / 100)
                        : "Not calculated"
                      : "Free"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 pt-2 text-lg font-semibold">
                  <dt>Order estimate</dt>
                  <dd>{estimate === null ? "—" : money(estimate)}</dd>
                </div>
              </dl>
              {form.fulfillment_date &&
                form.fulfillment_time &&
                !schedule.dateError &&
                !schedule.timeError && (
                  <p className="mt-4 rounded-xl bg-[#FAF7F5] p-3 text-sm leading-6 text-[#796D6A]">
                    {delivery ? "Delivery" : "Requested pickup"}
                    <br />
                    {formatServiceDate(form.fulfillment_date)} at{" "}
                    {formatServiceTime(form.fulfillment_time)}
                    <br />
                    <span className="text-xs">Houston / Katy time</span>
                  </p>
                )}
              <p className="mt-4 text-xs leading-5 text-[#796D6A]">
                The final amount is confirmed when your order is saved. Saving a
                request does not charge your card or confirm your booking.
              </p>
              {missingStep && (
                <p
                  id="checkout-next-step"
                  role="status"
                  className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900"
                >
                  {missingStep}
                </p>
              )}
              <button
                type="submit"
                disabled={submitting || quoteBusy || Boolean(missingStep)}
                aria-describedby={
                  missingStep ? "checkout-next-step" : undefined
                }
                className="mt-4 min-h-12 w-full rounded-full bg-[#B76473] px-5 py-4 text-sm font-semibold text-white hover:bg-[#A65363] disabled:opacity-50"
              >
                {submitting
                  ? "Saving your request..."
                  : paymentsEnabled
                    ? "Save & continue to payment"
                    : "Save order request"}
              </button>
              <p className="mt-3 text-center text-xs leading-5 text-[#796D6A]">
                {paymentsEnabled
                  ? "Full payment is collected securely on Stripe next."
                  : "Online payments are currently unavailable. No charge will be made."}
              </p>
            </aside>
          </form>
        )}
      </div>
    </main>
  );
}
