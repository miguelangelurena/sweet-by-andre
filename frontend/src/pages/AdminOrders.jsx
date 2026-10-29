import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../services/api";

const PAGE_SIZE = 8;

// The server independently enforces these same transitions and paid-only rule.
const NEXT_FULFILLMENT_ACTION = {
  pending: { target: "confirmed", label: "Accept order" },
  confirmed: { target: "preparing", label: "Start preparing" },
  preparing: { target: "ready", label: "Mark as ready" },
  ready: { target: "completed", label: "Mark as completed" },
};

const money = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value ?? 0),
  );

const formatDate = (value) => {
  if (!value) return "Not provided";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Not provided"
    : parsed.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
};

const statusLabel = (value) =>
  String(value ?? "unknown").replaceAll("_", " ");

const cleanText = (value) =>
  value === null || value === undefined || value === ""
    ? "Not provided"
    : String(value);

function readableOptions(snapshot) {
  if (!snapshot) return [];
  let parsed = snapshot;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [{ name: "Option", value: parsed }];
    }
  }

  if (Array.isArray(parsed)) {
    return parsed.flatMap((option) => {
      if (option == null) return [];
      if (typeof option !== "object") return [{ name: "Option", value: String(option) }];

      const name = option.option_name ?? option.name ?? option.label ?? "Option";
      const value = option.value ?? option.option_value ?? option.selected_value;
      return value === undefined || value === null
        ? []
        : [{ name: String(name), value: String(value) }];
    });
  }

  if (parsed && typeof parsed === "object") {
    if ("option_name" in parsed || "name" in parsed) {
      const name = parsed.option_name ?? parsed.name ?? "Option";
      const value = parsed.value ?? parsed.option_value;
      return value == null ? [] : [{ name: String(name), value: String(value) }];
    }
    return Object.entries(parsed)
      .filter(([, value]) => value != null)
      .map(([name, value]) => ({ name, value: String(value) }));
  }

  return [{ name: "Option", value: String(parsed) }];
}

function Skeleton({ className = "" }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-lg bg-[#EDE4E1] motion-safe:animate-pulse ${className}`}
    />
  );
}

function OrderRowSkeleton({ index }) {
  return (
    <tr className="border-t border-[#E7DCD9]" aria-hidden="true" key={index}>
      <td className="p-4"><Skeleton className="h-4 w-24" /></td>
      <td className="p-4"><Skeleton className="h-4 w-16" /></td>
      <td className="p-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
      <td className="p-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
      <td className="p-4"><Skeleton className="h-4 w-28" /></td>
      <td className="p-4"><Skeleton className="h-4 w-20" /></td>
    </tr>
  );
}

function StatusPill({ value }) {
  const color = value === "paid" || value === "completed" || value === "confirmed"
    ? "bg-emerald-50 text-emerald-800"
    : value === "failed" || value === "cancelled"
      ? "bg-red-50 text-red-800"
      : "bg-amber-50 text-amber-800";
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold capitalize ${color}`}>
      {statusLabel(value)}
    </span>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5 p-5 sm:p-7" role="status" aria-label="Loading order details">
      <Skeleton className="h-6 w-40" />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-40 max-w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-5 w-20" />
      <Skeleton className="h-24 w-full" />
      <span className="sr-only">Loading order details...</span>
    </div>
  );
}

function DetailField({ title, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-[#847873]">{title}</dt>
      <dd className="mt-1 break-words text-sm text-[#282323]">{children}</dd>
    </div>
  );
}

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, has_more: false });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [filter, setFilter] = useState("all");
  const [orderFilter, setOrderFilter] = useState("all");
  const [deliveryWindow, setDeliveryWindow] = useState("all");
  const [workloadOnly, setWorkloadOnly] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [showAdditionalInfo, setShowAdditionalInfo] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [statusNotice, setStatusNotice] = useState("");
  const [refundReview, setRefundReview] = useState(null);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundError, setRefundError] = useState("");

  const requestsVersion = useRef(0);
  const moreAbort = useRef(null);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const openerRef = useRef(null);

  function pageUrl(offset, activeFilter) {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (activeFilter !== "all") params.set("payment_status", activeFilter);
    if (orderFilter !== "all") params.set("order_status", orderFilter);
    if (deliveryWindow !== "all") params.set("delivery_window", deliveryWindow);
    if (workloadOnly) params.set("workload", "active");
    return `/admin/orders?${params.toString()}`;
  }

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestsVersion.current;
    moreAbort.current?.abort();
    setOrders([]);
    setPagination({ total: 0, has_more: false });
    setLoadingMore(false);
    setLoading(true);
    setError("");
    setMoreError("");

    apiRequest(pageUrl(0, filter), { signal: controller.signal })
      .then((data) => {
        if (version !== requestsVersion.current) return;
        setOrders(Array.isArray(data.orders) ? data.orders : []);
        setPagination(data.pagination ?? { total: 0, has_more: false });
      })
      .catch((err) => {
        if (controller.signal.aborted || version !== requestsVersion.current) return;
        setError(err.message || "Could not load orders.");
      })
      .finally(() => {
        if (!controller.signal.aborted && version === requestsVersion.current) setLoading(false);
      });

    return () => {
      controller.abort();
      moreAbort.current?.abort();
    };
  }, [filter, orderFilter, deliveryWindow, workloadOnly, refreshVersion]);

  async function showMoreOrders() {
    if (loading || loadingMore || !pagination.has_more) return;
    const controller = new AbortController();
    moreAbort.current = controller;
    const version = requestsVersion.current;
    setLoadingMore(true);
    setMoreError("");

    try {
      const data = await apiRequest(pageUrl(orders.length, filter), {
        signal: controller.signal,
      });
      if (controller.signal.aborted || version !== requestsVersion.current) return;
      const nextOrders = Array.isArray(data.orders) ? data.orders : [];
      setOrders((previous) => {
        const seen = new Set(previous.map((order) => order.id));
        return [...previous, ...nextOrders.filter((order) => !seen.has(order.id))];
      });
      setPagination(data.pagination ?? { total: 0, has_more: false });
    } catch (err) {
      if (!controller.signal.aborted && version === requestsVersion.current) {
        setMoreError(err.message || "Could not load more orders.");
      }
    } finally {
      if (!controller.signal.aborted && version === requestsVersion.current) setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!selectedId) return undefined;
    const controller = new AbortController();
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);

    apiRequest(`/admin/orders/${encodeURIComponent(selectedId)}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setDetail({ order: data.order, items: data.items ?? [] });
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setDetailError(err.message || "Could not load order details.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });

    return () => controller.abort();
  }, [selectedId]);

  useEffect(() => {
    setRefundReview(null);
    setRefundError("");
    setRefundLoading(false);
  }, [selectedId]);

  async function loadRefundReview() {
    if (!selectedId || refundLoading) return;
    setRefundLoading(true);
    setRefundError("");
    try {
      const result = await apiRequest(`/admin/orders/${encodeURIComponent(selectedId)}/refund-review`);
      setRefundReview(result.review);
    } catch (err) {
      setRefundError(err.message || "Could not load refund review.");
    } finally {
      setRefundLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedId) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeys(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedId(null);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]',
        ),
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeys);
      openerRef.current?.focus();
    };
  }, [selectedId]);

  function openOrder(id, event) {
    openerRef.current = event.currentTarget;
    setShowAdditionalInfo(false);
    setStatusError("");
    setStatusNotice("");
    setSelectedId(id);
  }

  const order = detail?.order;
  const nextAction = order?.payment_status === "paid"
    ? NEXT_FULFILLMENT_ACTION[order.order_status]
    : null;

  async function advanceStatus() {
    if (!order || !nextAction || statusBusy) return;
    if (
      nextAction.target === "completed" &&
      !window.confirm("Confirm that this order has been completed and handed over to the customer?")
    ) return;

    const orderId = order.id;
    setStatusBusy(true);
    setStatusError("");
    setStatusNotice("");

    try {
      // This is the authenticated-session CSRF endpoint, NOT guest cart CSRF.
      const csrf = await apiRequest("/cart/csrf-token");
      if (!csrf?.csrf_token) throw new Error("Could not obtain admin session security token.");

      const result = await apiRequest(`/admin/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        headers: { "X-CSRF-Token": csrf.csrf_token },
        body: JSON.stringify({ target_status: nextAction.target }),
      });

      const updated = result.order;
      if (!updated || updated.id !== orderId) throw new Error("Unexpected server response.");

      setDetail((previous) => previous?.order?.id === orderId
        ? { ...previous, order: { ...previous.order, ...updated } }
        : previous);
      setOrders((previous) => previous.map((entry) =>
        entry.id === orderId ? { ...entry, ...updated } : entry,
      ));
      setStatusNotice(`Order moved to ${statusLabel(updated.order_status)}.`);
    } catch (err) {
      setStatusError(err.message || "Could not update order status.");
      // Keep the dialog visible for investigation; refresh the list so a
      // concurrent update in another admin tab is not hidden indefinitely.
      setRefreshVersion((version) => version + 1);
    } finally {
      setStatusBusy(false);
    }
  }

  async function cancelUnpaid() {
    if (!order || statusBusy || order.payment_status !== "pending" || order.order_status !== "pending") return;
    if (!window.confirm("Cancel this unpaid order? This cannot be undone.")) return;
    const orderId = order.id;
    setStatusBusy(true);
    setStatusError("");
    setStatusNotice("");
    try {
      const csrf = await apiRequest("/cart/csrf-token");
      if (!csrf?.csrf_token) throw new Error("Could not obtain admin session security token.");
      const result = await apiRequest(`/admin/orders/${encodeURIComponent(orderId)}/cancel-unpaid`, {
        method: "PATCH",
        headers: { "X-CSRF-Token": csrf.csrf_token },
      });
      if (!result.order || result.order.id !== orderId) throw new Error("Unexpected server response.");
      setDetail((previous) => previous?.order?.id === orderId
        ? { ...previous, order: { ...previous.order, ...result.order } }
        : previous);
      setOrders((previous) => previous.map((entry) =>
        entry.id === orderId ? { ...entry, ...result.order } : entry));
      setStatusNotice("Unpaid order cancelled.");
    } catch (err) {
      setStatusError(err.message || "Could not cancel order.");
      setRefreshVersion((version) => version + 1);
    } finally {
      setStatusBusy(false);
    }
  }

  const address = order
    ? [
        [order.shipping_street_number, order.shipping_street].filter(Boolean).join(" "),
        order.shipping_unit,
        order.shipping_city,
        order.shipping_state,
        order.shipping_zip_code,
      ].filter(Boolean).join(", ")
    : "";

  return (
    <main className="p-5 text-[#282323] sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl sm:text-4xl">Orders</h1>
          <p className="mt-2 text-sm text-[#756B69]">
            Review orders and update fulfillment after payment confirmation. Refunds are handled separately.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshVersion((version) => version + 1)}
          disabled={loading || loadingMore}
          className="rounded-full border border-[#D47783] px-5 py-2 text-sm font-semibold text-[#B76473] transition hover:bg-[#FAF0F1] disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label htmlFor="order-payment-filter" className="text-sm font-medium">Payment status</label>
        <select
          id="order-payment-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="rounded-lg border border-[#E7DCD9] bg-white px-3 py-2 text-sm"
        >
          <option value="all">All payments</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="failed">Failed</option>
        </select>
        {!loading && !error && (
          <p className="text-sm text-[#756B69]" aria-live="polite">
            Showing {orders.length} of {pagination.total} orders
          </p>
        )}
        {loading && <Skeleton className="h-4 w-36" />}
      </div>

      <div className="mt-4 grid gap-3 rounded-2xl border border-[#E7DCD9] bg-white p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Workload filters">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#756B69]">
          Fulfillment status
          <select aria-label="Fulfillment status" value={orderFilter} onChange={(event) => setOrderFilter(event.target.value)}
            className="min-h-11 rounded-xl border border-[#E7DCD9] bg-white px-3 text-sm font-normal text-[#282323]">
            <option value="all">All statuses</option>
            {Object.keys(NEXT_FULFILLMENT_ACTION).concat("completed", "cancelled").map((state) =>
              <option key={state} value={state}>{statusLabel(state)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#756B69]">
          Delivery schedule
          <select aria-label="Delivery schedule" value={deliveryWindow} onChange={(event) => setDeliveryWindow(event.target.value)}
            className="min-h-11 rounded-xl border border-[#E7DCD9] bg-white px-3 text-sm font-normal text-[#282323]">
            <option value="all">Any date</option>
            <option value="today">Due today</option>
            <option value="next7">Next 7 days</option>
            <option value="overdue">Overdue</option>
          </select>
        </label>
        <label className="flex items-center gap-3 rounded-xl border border-[#E7DCD9] px-3 py-2 text-sm font-medium text-[#282323] lg:mt-5">
          <input type="checkbox" checked={workloadOnly} onChange={(event) => setWorkloadOnly(event.target.checked)}
            className="h-4 w-4 accent-[#B76473]" />
          Active paid workload
        </label>
        <button type="button" onClick={() => { setFilter("all"); setOrderFilter("all"); setDeliveryWindow("all"); setWorkloadOnly(false); }}
          className="min-h-11 rounded-xl border border-[#E7DCD9] px-3 text-sm font-semibold text-[#B76473] hover:bg-[#FAF0F1] lg:mt-5">
          Clear filters
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
          <button type="button" onClick={() => setRefreshVersion((n) => n + 1)} className="ml-3 font-semibold underline">Try again</button>
        </div>
      )}

      <div className="mt-5 overflow-x-auto rounded-2xl border border-[#E7DCD9] bg-white shadow-sm">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="bg-[#FAF7F5] text-[#756B69]">
            <tr>
              <th scope="col" className="p-4">Order</th>
              <th scope="col" className="p-4">Total</th>
              <th scope="col" className="p-4">Payment</th>
              <th scope="col" className="p-4">Order status</th>
              <th scope="col" className="p-4">Delivery</th>
              <th scope="col" className="p-4">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }, (_, index) => <OrderRowSkeleton key={index} index={index} />)
              : orders.map((item) => (
                <tr key={item.id} className="border-t border-[#E7DCD9] transition hover:bg-[#FFFBFA]">
                  <td className="p-4 font-mono text-xs" title={item.id}>{item.id.slice(0, 8)}…</td>
                  <td className="p-4 font-semibold">{money(item.total)}</td>
                  <td className="p-4"><StatusPill value={item.payment_status} /></td>
                  <td className="p-4"><StatusPill value={item.order_status} /></td>
                  <td className="p-4">{formatDate(item.delivery_date)}</td>
                  <td className="p-4">
                    <button
                      type="button"
                      onClick={(event) => openOrder(item.id, event)}
                      className="rounded-lg px-2 py-2 font-semibold text-[#B76473] hover:bg-[#FAF0F1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B76473]"
                      aria-label={`View order ${item.id.slice(0, 8)}`}
                    >
                      View order
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && !error && orders.length === 0 && (
          <div className="p-10 text-center text-sm text-[#756B69]">No orders found for this filter.</div>
        )}
      </div>

      {pagination.has_more && !loading && !error && (
        <div className="mt-5 flex flex-col items-center gap-3">
          {moreError && <p role="alert" className="text-sm text-red-700">{moreError}</p>}
          <button
            type="button"
            onClick={showMoreOrders}
            disabled={loadingMore}
            className="rounded-full border border-[#D47783] bg-white px-7 py-3 text-sm font-semibold text-[#B76473] hover:bg-[#FAF0F1] disabled:opacity-50"
          >
            {loadingMore ? "Loading more..." : "Show more orders"}
          </button>
          {loadingMore && <div role="status" className="w-full max-w-xl space-y-2"><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-4/5" /><span className="sr-only">Loading more orders...</span></div>}
        </div>
      )}

      {selectedId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
          <button type="button" tabIndex={-1} aria-label="Close order details" onClick={() => setSelectedId(null)} className="absolute inset-0 cursor-default bg-[#282323]/55" />
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-detail-title"
            className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#E7DCD9] px-5 py-4 sm:px-7">
              <div className="min-w-0">
                <h2 id="order-detail-title" className="font-serif text-2xl">Order details</h2>
                <p className="mt-1 break-all font-mono text-xs text-[#756B69]">{selectedId}</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setSelectedId(null)}
                className="shrink-0 rounded-full border border-[#E7DCD9] px-4 py-2 text-sm font-semibold text-[#756B69] hover:bg-[#FAF7F5]"
              >
                Close ✕
              </button>
            </header>

            <div className="min-h-0 overflow-y-auto overscroll-contain">
              {detailLoading && <DetailSkeleton />}
              {detailError && (
                <div role="alert" className="m-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">
                  {detailError}
                  <button type="button" className="ml-3 font-semibold underline" onClick={() => setSelectedId(null)}>Close</button>
                </div>
              )}
              {order && !detailLoading && (
                <div className="p-5 sm:p-7">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#FAF7F5] p-4">
                    <div>
                      <p className="text-xs text-[#756B69]">Order total</p>
                      <p className="mt-1 font-serif text-2xl">{money(order.total)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill value={order.payment_status} />
                      <StatusPill value={order.order_status} />
                    </div>
                  </div>

                  <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-[#756B69]">Customer & delivery</h3>
                  <dl className="mt-3 grid gap-x-5 gap-y-4 sm:grid-cols-2">
                    <DetailField title="Customer">{cleanText(order.shipping_name)}</DetailField>
                    <DetailField title="Delivery date">{formatDate(order.delivery_date)}</DetailField>
                    <DetailField title="Email">{cleanText(order.customer_email)}</DetailField>
                    <DetailField title="Phone">{cleanText(order.customer_phone)}</DetailField>
                  </dl>

                  <button
                    type="button"
                    aria-expanded={showAdditionalInfo}
                    onClick={() => setShowAdditionalInfo((visible) => !visible)}
                    className="mt-5 text-sm font-semibold text-[#B76473] hover:underline"
                  >
                    {showAdditionalInfo ? "Show less delivery information −" : "See more delivery information +"}
                  </button>
                  {showAdditionalInfo && (
                    <dl className="mt-4 space-y-4 rounded-xl border border-[#E7DCD9] p-4">
                      <DetailField title="Delivery address">{address || "Not provided"}</DetailField>
                      {order.delivery_instructions && <DetailField title="Delivery instructions">{order.delivery_instructions}</DetailField>}
                      {order.note && <DetailField title="Order notes">{order.note}</DetailField>}
                    </dl>
                  )}

                  <h3 className="mt-7 text-sm font-bold uppercase tracking-wide text-[#756B69]">Items</h3>
                  <div className="mt-3 space-y-3">
                    {(detail.items ?? []).length === 0 && <p className="text-sm text-[#756B69]">No order items found.</p>}
                    {(detail.items ?? []).map((item, index) => (
                      <article key={item.id ?? index} className="rounded-xl border border-[#E7DCD9] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold">{item.product_name_snapshot ?? item.product_name ?? "Product"}</p>
                            <p className="mt-1 text-xs text-[#756B69]">{item.quantity} × {money(item.unit_price)}</p>
                          </div>
                          <p className="font-semibold">{money(Number(item.quantity) * Number(item.unit_price))}</p>
                        </div>
                        {readableOptions(item.options_snapshot).length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {readableOptions(item.options_snapshot).map((option, optionIndex) => (
                              <span key={`${option.name}-${optionIndex}`} className="rounded-lg bg-[#FAF0F1] px-3 py-1.5 text-xs text-[#574644]">
                                <span className="font-semibold">{option.name}:</span> {option.value}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.notes && <p className="mt-3 text-sm text-[#756B69]"><strong>Instructions:</strong> {item.notes}</p>}
                      </article>
                    ))}
                  </div>
                  <p className="mt-6 text-xs leading-5 text-[#756B69]">
                    Payment status is confirmed by Stripe webhooks, never by this admin page.
                  </p>

                  <section aria-label="Refund review" className="mt-5 rounded-xl border border-[#E7DCD9] p-4">
                    <h3 className="font-semibold">Refund review</h3>
                    <p className="mt-2 text-sm text-[#756B69]">Read-only information. No payment or refund will be initiated.</p>
                    <button type="button" onClick={loadRefundReview} disabled={refundLoading}
                      className="mt-3 rounded-full border border-[#B76473] px-5 py-2.5 text-sm font-semibold text-[#B76473] disabled:opacity-50">
                      {refundLoading ? "Checking..." : "Check refund status"}
                    </button>
                    {refundLoading && <div className="mt-3 space-y-2" role="status"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /><span className="sr-only">Loading refund review...</span></div>}
                    {refundError && <p role="alert" className="mt-3 text-sm text-red-700">{refundError}</p>}
                    {refundReview && <div className="mt-3 rounded-lg bg-[#FAF7F5] p-3 text-sm">
                      <p className="font-semibold">{refundReview.review_status.replaceAll("_", " ")}</p>
                      <p className="mt-1 text-[#756B69]">{refundReview.message}</p>
                      <p className="mt-2 text-xs text-[#756B69]">Refunds are disabled. Contact the developer for Stripe reconciliation.</p>
                    </div>}
                  </section>

                  <section aria-label="Fulfillment actions" className="mt-5 rounded-xl border border-[#E7DCD9] bg-[#FAF7F5] p-4">
                    <h3 className="font-semibold">Fulfillment</h3>
                    {order.payment_status !== "paid" ? (
                      <p className="mt-2 text-sm text-[#756B69]">
                        Waiting for confirmed payment. Orders cannot be accepted or prepared before Stripe confirms the payment.
                      </p>
                    ) : nextAction ? (
                      <>
                        <p className="mt-2 text-sm text-[#756B69]">
                          Next step: {statusLabel(nextAction.target)}. Changes are saved immediately.
                        </p>
                        <button
                          type="button"
                          onClick={advanceStatus}
                          disabled={statusBusy}
                          className="mt-3 rounded-full bg-[#B76473] px-5 py-3 text-sm font-semibold text-white hover:bg-[#A65363] disabled:cursor-wait disabled:opacity-60"
                        >
                          {statusBusy ? "Updating order..." : nextAction.label}
                        </button>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-[#756B69]">
                        No further fulfillment actions are available for this order.
                      </p>
                    )}
                    {order.payment_status === "pending" && order.order_status === "pending" && (
                      <div className="mt-4 border-t border-[#E7DCD9] pt-4">
                        <p className="text-xs text-[#756B69]">Cancellation is only available when no payment attempt or inventory reservation exists. The server checks this independently.</p>
                        <button type="button" onClick={cancelUnpaid} disabled={statusBusy}
                          className="mt-3 rounded-full border border-red-300 px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                          {statusBusy ? "Updating..." : "Cancel unpaid order"}
                        </button>
                      </div>
                    )}
                    {statusNotice && <p role="status" className="mt-3 text-sm font-medium text-emerald-700">{statusNotice}</p>}
                    {statusError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{statusError}</p>}
                  </section>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
