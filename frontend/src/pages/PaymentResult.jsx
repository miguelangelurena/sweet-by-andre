import { useEffect, useState } from "react";
import { apiRequest } from "../services/api";

const STORAGE_KEY = "sba:pending-order-request:v1";
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value ?? 0));

function savedOrderId() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    return saved?.order?.id ?? null;
  } catch { return null; }
}

export default function PaymentResult({ kind }) {
  const [state, setState] = useState({ loading: true, order: null, error: "" });
  useEffect(() => {
    let active = true;
    const id = savedOrderId();
    if (!id) {
      setState({ loading: false, order: null, error: "We could not identify an order from this tab. Please contact the bakery with your order details." });
      return;
    }
    // Never accept Stripe query parameters or browser storage as confirmation
    // of payment. The server reads the authoritative PostgreSQL order state.
    apiRequest(`/guest/orders/${encodeURIComponent(id)}/status`)
      .then((response) => {
        if (active) setState({ loading: false, order: response.order, error: "" });
      })
      .catch((error) => {
        if (active) setState({ loading: false, order: null, error: error.message });
      });
    return () => { active = false; };
  }, [kind]);

  const paid = state.order?.payment_status === "paid";
  const title = paid ? "Payment confirmed" : kind === "success" ? "Payment is being verified" : "Checkout was not completed";

  return (
    <main className="min-h-screen bg-[#FAF7F5] px-4 py-12 text-[#282323]">
      <section className="mx-auto max-w-2xl rounded-3xl border border-[#E7DCD9] bg-white p-7 sm:p-10">
        <h1 className="font-serif text-4xl">{title}</h1>
        {state.loading ? (
          <p className="mt-5 text-[#796D6A]">Checking the current order status...</p>
        ) : state.error ? (
          <p className="mt-5 text-red-700" role="alert">{state.error}</p>
        ) : (
          <>
            <p className="mt-5 text-[#796D6A]">
              {paid
                ? "The server has verified payment for this order. The bakery will handle fulfillment separately."
                : kind === "success"
                  ? "Returning from Stripe does not confirm payment. Your order is not marked paid yet. Please contact the bakery if the status does not update."
                  : "You returned without completing Checkout. Your order remains subject to its current payment status."}
            </p>
            <p className="mt-5 break-all text-sm"><strong>Order:</strong> {state.order.id}</p>
            <p className="mt-2"><strong>Total:</strong> {money(state.order.total)}</p>
            <p className="mt-2"><strong>Payment status:</strong> {state.order.payment_status}</p>
            <p className="mt-2"><strong>Order status:</strong> {state.order.order_status}</p>
          </>
        )}
        <a href="/#checkout" className="mt-7 inline-block rounded-full bg-[#B76473] px-6 py-3 font-semibold text-white">Return to order</a>
        <p className="mt-5 text-xs text-[#796D6A]">Payment is confirmed only by our backend after Stripe webhook validation, never by this return page.</p>
      </section>
    </main>
  );
}
