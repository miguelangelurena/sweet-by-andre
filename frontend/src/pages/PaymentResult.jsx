import { useEffect, useState } from "react";
import { apiRequest } from "../services/api";

const STORAGE_KEY = "sba:pending-order-request:v1";
const MAX_CHECKS = 12;
const CHECK_INTERVAL_MS = 2500;
const money = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value ?? 0),
  );
const paymentLabels = {
  pending: "Awaiting confirmation",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
  refund_pending: "Refund pending",
};
const orderLabels = {
  pending: "Awaiting bakery acceptance",
  confirmed: "Accepted",
  preparing: "Being prepared",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
  refund_pending: "Refund in progress",
};

function savedOrderId() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    return saved?.order?.id ?? null;
  } catch {
    return null;
  }
}

export default function PaymentResult({ kind }) {
  const [state, setState] = useState({
    loading: true,
    order: null,
    error: "",
    polling: false,
  });
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    let timer;
    let checks = 0;
    const controller = new AbortController();
    const id = savedOrderId();
    if (!id) {
      setState({
        loading: false,
        order: null,
        polling: false,
        error:
          "We could not find an order in this tab. Return to your order or contact Andrea for help.",
      });
      return;
    }
    setState({ loading: true, order: null, error: "", polling: false });
    async function check() {
      checks++;
      try {
        // Only the backend's current state can confirm payment. Browser storage
        // and Stripe return parameters identify a request, never a paid order.
        const response = await apiRequest(
          `/guest/orders/${encodeURIComponent(id)}/status`,
          { signal: controller.signal },
        );
        if (!active) return;
        const order = response?.order;
        if (!order || order.id !== id)
          throw new Error(
            "We could not verify the order response. Please try again.",
          );
        const polling =
          kind === "success" &&
          order.payment_status === "pending" &&
          !["cancelled", "refund_pending", "completed"].includes(
            order.order_status,
          ) &&
          checks < MAX_CHECKS;
        setState({ loading: false, order, error: "", polling });
        if (polling) timer = setTimeout(check, CHECK_INTERVAL_MS);
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setState((previous) => ({
          ...previous,
          loading: false,
          polling: false,
          error:
            error.message || "Could not check your payment. Please try again.",
        }));
      }
    }
    check();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [kind, refresh]);

  const paid = state.order?.payment_status === "paid";
  const refunded = state.order?.payment_status === "refunded";
  const closed = ["cancelled", "refund_pending"].includes(
    state.order?.order_status,
  );
  const title = state.loading
    ? "Checking your payment"
    : paid
      ? "Payment confirmed"
      : refunded
        ? "Payment refunded"
        : closed
          ? "Your order status"
          : state.error
            ? "Let's check your order"
            : kind === "success"
              ? "Waiting for payment confirmation"
              : "Checkout was not completed";

  return (
    <main className="min-h-screen bg-[#FAF7F5] px-4 py-8 text-[#282323] sm:py-12">
      <section className="mx-auto max-w-2xl rounded-3xl border border-[#E7DCD9] bg-white p-5 sm:p-10">
        <h1 className="font-serif text-3xl sm:text-4xl">{title}</h1>
        {state.loading ? (
          <p role="status" className="mt-5 text-sm leading-6 text-[#796D6A]">
            Checking the latest status of your order...
          </p>
        ) : (
          <>
            {state.error && (
              <p className="mt-5 text-sm leading-6 text-red-700" role="alert">
                {state.error}
              </p>
            )}
            {state.order && (
              <>
                <p className="mt-5 text-sm leading-6 text-[#796D6A]">
                  {paid
                    ? `Your payment has been verified. ${state.order.order_status === "pending" ? "Andrea still needs to accept your order and coordinate fulfillment with you." : "See the bakery's current progress below."}`
                    : refunded || closed
                      ? "Contact Andrea if you have questions about this order."
                      : state.polling
                        ? "Your payment confirmation may take a few moments. This page checks automatically; you do not need to pay again."
                        : kind === "success"
                          ? "Your payment has not been confirmed yet. Check again in a moment or contact Andrea with your order number."
                          : "You returned without completing Checkout. You can return to your order to continue when ready."}
                </p>
                <dl className="mt-6 space-y-4 text-sm">
                  <div>
                    <dt className="font-semibold">Order number</dt>
                    <dd className="mt-1 break-all text-[#796D6A]">
                      {state.order.id}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="font-semibold">Total</dt>
                    <dd>{money(state.order.total)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="font-semibold">Payment</dt>
                    <dd className={paid ? "text-green-800" : "text-[#796D6A]"}>
                      {paymentLabels[state.order.payment_status] ??
                        state.order.payment_status}
                    </dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="font-semibold">Bakery status</dt>
                    <dd className="text-[#796D6A]">
                      {orderLabels[state.order.order_status] ??
                        state.order.order_status}
                    </dd>
                  </div>
                </dl>
                {state.polling && (
                  <p
                    role="status"
                    className="mt-5 rounded-xl bg-[#FAF7F5] p-3 text-sm text-[#796D6A]"
                  >
                    Checking for payment confirmation…
                  </p>
                )}
              </>
            )}
            {!paid &&
              !refunded &&
              !closed &&
              !state.polling &&
              savedOrderId() && (
                <button
                  type="button"
                  onClick={() => setRefresh((value) => value + 1)}
                  className="mt-5 min-h-12 w-full rounded-full border border-[#B76473] px-5 py-3 font-semibold text-[#9E4F60]"
                >
                  Check payment again
                </button>
              )}
          </>
        )}
        <a
          href="/#checkout"
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#B76473] px-5 py-3 text-sm font-semibold text-white"
        >
          Return to order
        </a>
        {!state.loading && !state.polling && !paid && (
          <a
            href="mailto:sweetbyandre@gmail.com"
            className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[#9E4F60] underline"
          >
            Contact Andrea
          </a>
        )}
        <p className="mt-5 text-xs leading-5 text-[#796D6A]">
          Returning from Stripe does not confirm payment. Your order is marked
          paid only after the bakery's system verifies it.
        </p>
      </section>
    </main>
  );
}
