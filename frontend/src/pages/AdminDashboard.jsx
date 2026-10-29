import { useEffect, useState } from "react";
import { apiRequest } from "../services/api";

const money = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v ?? 0));
const date = (v) => v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const CARDS = [
  ["Paid orders", "paid_orders", "Orders confirmed by payment"],
  ["Awaiting review", "awaiting_acceptance", "Paid, awaiting acceptance"],
  ["Active workload", "active_orders", "Paid orders not yet completed"],
  ["Upcoming deliveries", "next_seven_days", "Active orders due in 7 days"],
  ["Visible products", "listed_products", "Published, in active categories"],
  ["Unpaid requests", "awaiting_payment", "Not counted as sales"],
];
export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError("");
    try { setData(await apiRequest("/admin/dashboard/summary")); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { let active=true; apiRequest("/admin/dashboard/summary").then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);}); return ()=>{active=false;}; }, []);
  return <main className="px-4 py-8 sm:px-8 lg:px-10">
    <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-[#B76473]">Bakery overview</p>
        <h1 className="mt-2 font-serif text-4xl">Dashboard</h1>
        <p className="mt-2 text-sm text-[#756B69]">A snapshot of paid sales and upcoming work.</p></div>
      <button type="button" onClick={load} disabled={loading} className="rounded-xl border border-[#E7DCD9] bg-white px-5 py-3 text-sm font-semibold text-[#B76473] hover:bg-[#FAF0F1] disabled:opacity-50">Refresh</button>
    </div>
    {error && <p role="alert" className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error} <button onClick={load} className="ml-2 underline">Retry</button></p>}
    {loading ? <div role="status" aria-label="Loading dashboard" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({length:6},(_,i)=><div key={i} className="sba-skeleton h-36 rounded-2xl" />)}</div> : data && <>
      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map(([label,key,detail])=><div key={key} className="rounded-2xl border border-[#E7DCD9] bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-[#756B69]">{label}</p><p className="mt-3 font-serif text-4xl text-[#282323]">{data.summary[key] ?? 0}</p>
          <p className="mt-2 text-xs text-[#887D79]">{detail}</p></div>)}
      </section>
      <section className="mt-5 rounded-2xl border border-[#E7DCD9] bg-white p-6">
        <p className="text-sm font-semibold text-[#756B69]">Gross value of paid orders</p>
        <p className="mt-2 font-serif text-4xl text-[#282323]">{money(data.summary.gross_paid_total)}</p>
        <p className="mt-2 text-xs leading-5 text-[#887D79]">Not net earnings or Stripe payouts. This excludes unpaid orders, but does not subtract refunds, disputes, fees or taxes.</p>
      </section>
      <section className="mt-7 overflow-hidden rounded-2xl border border-[#E7DCD9] bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-[#E7DCD9] p-5 sm:p-6"><h2 className="font-serif text-2xl">Recent orders</h2><a href="#admin/orders" className="text-sm font-semibold text-[#B76473] hover:underline">View all orders →</a></div>
        {data.recent_orders?.length ? <div className="divide-y divide-[#F0E7E4]">{data.recent_orders.map(o=><div key={o.id} className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-6">
          <div><p className="font-semibold text-[#282323]">{o.shipping_name || `Order #${o.id.slice(0,8)}`}</p><p className="mt-1 text-xs text-[#756B69]">Delivery {date(o.delivery_date)} · {o.order_status}</p></div>
          <div className="text-right"><p className="font-semibold">{money(o.total)}</p><p className={`text-xs font-medium ${o.payment_status==='paid'?'text-green-700':'text-amber-700'}`}>{o.payment_status}</p></div></div>)}</div> : <p className="p-6 text-sm text-[#756B69]">No orders yet.</p>}
      </section>
    </>}
  </main>;
}
