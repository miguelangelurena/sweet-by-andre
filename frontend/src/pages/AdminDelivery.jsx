import { useEffect, useState } from "react";
import { getAdminDelivery, saveAdminDelivery } from "../services/api";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const input = "w-full rounded-lg border border-[#E7DCD9] bg-white px-3 py-2 text-sm disabled:opacity-50";
const panel = "rounded-2xl border border-[#E7DCD9] bg-white p-5 sm:p-7";
const nullableNumber = (value) => value === "" ? null : Number(value);
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

export default function AdminDelivery() {
  const [settings, setSettings] = useState(null);
  const [availability, setAvailability] = useState([]);
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    getAdminDelivery().then((data) => {
      if (active) { setSettings(data.settings); setAvailability(data.availability); setRouting(data.routing_configured); }
    }).catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  function update(key, value) { setSettings((current) => ({ ...current, config: { ...current.config, [key]: value } })); setNotice(""); }
  function updateWeek(index, key, value) { update("weekly_hours", settings.config.weekly_hours.map((day, i) => i === index ? { ...day, [key]: value } : day)); }
  function updateException(index, key, value) { update("date_overrides", settings.config.date_overrides.map((day, i) => i === index ? { ...day, [key]: value } : day)); }
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await saveAdminDelivery(settings);
      setSettings(result.settings);
      setNotice("Delivery settings saved. New orders will use this schedule. Existing paid orders keep their arrangements.");
      const fresh = await getAdminDelivery(); setAvailability(fresh.availability);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const config = settings?.config;
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 text-[#282323] sm:p-8">
      <div><h1 className="font-serif text-4xl">Delivery &amp; pickup</h1><p className="mt-3 text-sm leading-6 text-[#796D6A]">Manage delivery availability without changing the website. All dates and hours use Houston / Katy time (America/Chicago). Orders require at least 48 hours’ notice.</p></div>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-800">{notice}</p>}
      {loading ? <p>Loading settings...</p> : config && (
        <form onSubmit={save} className="space-y-6">
          <fieldset disabled={busy} className={`${panel} space-y-5`}>
            <legend className="sr-only">Delivery setup</legend>
            <h2 className="font-serif text-2xl">Delivery setup</h2>
            <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={config.delivery_enabled} onChange={(e) => update("delivery_enabled", e.target.checked)} className="h-4 w-4 accent-[#B76473]" />Enable delivery at checkout</label>
            {!routing && <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">Road-distance quotes are not configured yet. The server needs GOOGLE_ROUTES_API_KEY before delivery can be enabled. Pickup remains available.</p>}
            <label className="block text-sm font-medium">Departure address (administrator only)<input className={`${input} mt-2`} value={config.origin_address} onChange={(e) => update("origin_address", e.target.value)} maxLength={500} placeholder="Full departure address, Katy, TX, ZIP" /><span className="mt-1 block text-xs font-normal text-[#796D6A]">Used to calculate one-way driving distance. This address is not returned by the public settings API.</span></label>
            <div className="grid gap-5 sm:grid-cols-3">
              <label className="text-sm font-medium">Maximum deliveries per day<input type="number" min="1" max="1000" className={`${input} mt-2`} value={config.daily_limit ?? ""} placeholder="No limit" onChange={(e) => update("daily_limit", nullableNumber(e.target.value))} /><span className="mt-1 block text-xs font-normal text-[#796D6A]">Leave blank for no limit. Stock still limits the units available for purchase.</span></label>
              <label className="text-sm font-medium">Minimum purchase ($)<input type="number" min="0" step="0.01" className={`${input} mt-2`} value={config.minimum_subtotal_cents / 100} onChange={(e) => update("minimum_subtotal_cents", Math.round(Number(e.target.value) * 100))} /></label>
              <label className="text-sm font-medium">Minimum applies to<select className={`${input} mt-2`} value={config.minimum_scope} onChange={(e) => update("minimum_scope", e.target.value)}><option value="delivery">Delivery only</option><option value="all">Delivery and pickup</option></select></label>
            </div>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-[#B76473]" checked={config.pickup_same_hours} onChange={(e) => update("pickup_same_hours", e.target.checked)} /><span>Apply these hours and blocked dates to pickup too. Otherwise pickup times are requests to coordinate directly with the bakery.</span></label>
          </fieldset>

          <fieldset disabled={busy} className={panel}>
            <legend className="sr-only">Weekly schedule</legend><h2 className="font-serif text-2xl">Weekly delivery hours</h2>
            <p className="mt-2 text-sm text-[#796D6A]">Closing time is the end of the delivery window. Turn a day off to stop new bookings that day.</p>
            <div className="mt-5 space-y-3">{config.weekly_hours.map((day, index) => (
              <div key={DAYS[index]} className="grid items-center gap-3 rounded-xl bg-[#FAF7F5] p-3 sm:grid-cols-[160px_1fr_1fr]">
                <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" checked={day.enabled} onChange={(e) => updateWeek(index, "enabled", e.target.checked)} className="h-4 w-4 accent-[#B76473]" />{DAYS[index]}</label>
                <label className="text-xs">From<input aria-label={`${DAYS[index]} opens`} type="time" className={`${input} mt-1`} value={day.start} onChange={(e) => updateWeek(index, "start", e.target.value)} /></label>
                <label className="text-xs">Until<input aria-label={`${DAYS[index]} closes`} type="time" className={`${input} mt-1`} value={day.end} onChange={(e) => updateWeek(index, "end", e.target.value)} /></label>
              </div>
            ))}</div>
          </fieldset>

          <fieldset disabled={busy} className={panel}>
            <legend className="sr-only">Date exceptions</legend><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-serif text-2xl">Blocked dates &amp; special hours</h2><button type="button" className="rounded-full border border-[#B76473] px-4 py-2 text-sm font-semibold text-[#9E4F60]" onClick={() => update("date_overrides", [...config.date_overrides, { date: "", closed: true, start: null, end: null, daily_limit: null, note: "" }])}>Add date</button></div>
            <p className="mt-2 text-sm leading-6 text-[#796D6A]">Block a specific date or set a different window and delivery limit. Existing paid orders and active payment sessions keep their reserved places; contact those customers if plans change.</p>
            <div className="mt-5 space-y-4">{config.date_overrides.length === 0 && <p className="text-sm text-[#796D6A]">No exceptions. Weekly hours apply.</p>}{config.date_overrides.map((day, index) => (
              <div key={index} className="space-y-3 rounded-xl border border-[#E7DCD9] bg-[#FAF7F5] p-4">
                <div className="flex flex-wrap items-end gap-4"><label className="text-sm">Date<input aria-label={`Exception ${index + 1} date`} required type="date" className={`${input} mt-1`} value={day.date} onChange={(e) => updateException(index, "date", e.target.value)} /></label><label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={day.closed} onChange={(e) => updateException(index, "closed", e.target.checked)} className="accent-[#B76473]" />Closed / blocked</label><button type="button" onClick={() => update("date_overrides", config.date_overrides.filter((_, i) => i !== index))} className="ml-auto py-2 text-sm text-red-700 underline">Remove</button></div>
                {!day.closed && <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs">Opening time (optional)<input type="time" className={`${input} mt-1`} value={day.start ?? ""} onChange={(e) => updateException(index, "start", e.target.value || null)} /></label><label className="text-xs">Closing time (optional)<input type="time" className={`${input} mt-1`} value={day.end ?? ""} onChange={(e) => updateException(index, "end", e.target.value || null)} /></label><label className="text-xs">Delivery limit (optional)<input type="number" min="1" max="1000" className={`${input} mt-1`} value={day.daily_limit ?? ""} placeholder="Use daily default" onChange={(e) => updateException(index, "daily_limit", nullableNumber(e.target.value))} /></label></div>}
                <label className="block text-xs">Internal note<input className={`${input} mt-1`} maxLength={300} value={day.note} onChange={(e) => updateException(index, "note", e.target.value)} /></label>
              </div>
            ))}</div>
          </fieldset>

          <fieldset disabled={busy} className={panel}>
            <legend className="sr-only">Delivery prices</legend><h2 className="font-serif text-2xl">Mileage rates</h2><p className="mt-2 text-sm leading-6 text-[#796D6A]">One-way driving distance. Each upper bound is inclusive; the next band starts above it. Beyond the final band, customers must contact the bakery or select pickup.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{config.rates.map((band, index) => (
              <div key={index} className="rounded-xl bg-[#FAF7F5] p-4"><label className="block text-xs">Up to miles<input required type="number" min="0.1" step="0.1" className={`${input} mt-1`} value={band.up_to_miles} onChange={(e) => update("rates", config.rates.map((b, i) => i === index ? { ...b, up_to_miles: Number(e.target.value) } : b))} /></label><label className="mt-3 block text-xs">Fee ($)<input required type="number" min="0" step="0.01" className={`${input} mt-1`} value={band.fee_cents / 100} onChange={(e) => update("rates", config.rates.map((b, i) => i === index ? { ...b, fee_cents: Math.round(Number(e.target.value) * 100) } : b))} /></label></div>
            ))}</div>
          </fieldset>
          <button disabled={busy} type="submit" className="rounded-full bg-[#B76473] px-7 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Saving..." : "Save delivery settings"}</button>
        </form>
      )}
      {availability.length > 0 && <section className={panel}><h2 className="font-serif text-2xl">Upcoming availability</h2><p className="mt-2 text-sm leading-6 text-[#796D6A]">Pending orders hold a place for 30 minutes; payment sessions hold it while active. Paid orders retain their place for the delivery date. This view refreshes when settings are loaded or saved.</p><div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2 pr-4">Date</th><th className="pr-4">Window (Houston)</th><th className="pr-4">Daily limit</th><th>Available</th></tr></thead><tbody>{availability.slice(0, 21).map((day) => <tr key={day.date} className="border-b border-[#F1E5E2]"><td className="py-3 pr-4">{day.date}</td><td className="pr-4">{day.closed ? "Closed" : `${day.start}–${day.end}`}</td><td className="pr-4">{day.daily_limit ?? "No limit"}</td><td>{day.closed ? "—" : day.remaining ?? "No limit"}</td></tr>)}</tbody></table></div><p className="mt-4 text-xs text-[#796D6A]">Current minimum: {config ? money(config.minimum_subtotal_cents) : "—"}. Delivery must be enabled before customers can book.</p></section>}
    </main>
  );
}
