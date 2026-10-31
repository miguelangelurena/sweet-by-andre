const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const input = "mt-2 w-full rounded-xl border border-[#E7DCD9] px-3 py-3 text-sm";

export default function FulfillmentFields({ form, update, options, production, requiredPoints=0, quote, quoteBusy, quoteError, calculateQuote, subtotalCents }) {
  const delivery = form.fulfillment_method === "delivery";
  const day = options.days.find((item) => item.date === form.fulfillment_date);
  const scheduled = delivery || options.pickup_same_hours;
  const preparationDay = production?.days.find(item=>item.date===form.fulfillment_date);
  const preparationUnavailable = requiredPoints>0 && form.fulfillment_date && (!preparationDay || preparationDay.closed ||
    (preparationDay.remaining!==null && preparationDay.remaining<requiredPoints));
  const unavailable = preparationUnavailable || (scheduled && day && (day.closed || (delivery && day.remaining !== null && day.remaining <= 0)));
  const slots = [];
  if (scheduled && day && !unavailable) {
    const [h, m] = day.start.split(":").map(Number), [endH, endM] = day.end.split(":").map(Number);
    for (let minutes = h * 60 + m; minutes < endH * 60 + endM; minutes += 15) {
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      if (form.fulfillment_date > options.earliest_date ||
          (form.fulfillment_date === options.earliest_date && time >= options.earliest_time)) slots.push(time);
    }
  }
  const minimumApplies = delivery || options.minimum_scope === "all";
  return (
    <section className="mb-7 space-y-5 rounded-2xl bg-[#FAF7F5] p-5" aria-labelledby="fulfillment-title">
      <h3 id="fulfillment-title" className="font-serif text-2xl">How would you like your order?</h3>
      <div className="grid gap-3 sm:grid-cols-2">{["pickup", "delivery"].map((method) => (
        <label key={method} className={`flex items-center gap-3 rounded-xl border bg-white p-4 text-sm ${form.fulfillment_method === method ? "border-[#B76473]" : "border-[#E7DCD9]"}`}>
          <input type="radio" name="fulfillment_method" value={method} checked={form.fulfillment_method === method} onChange={update} disabled={method === "delivery" && !options.delivery_available} className="accent-[#B76473]" />
          <span>{method === "pickup" ? "Pickup · no delivery fee" : "Delivery · priced by road miles"}</span>
        </label>
      ))}</div>
      {!options.delivery_available && <p className="text-sm leading-6 text-[#796D6A]">Online delivery booking is not available yet. You can request pickup or <a href="mailto:sweetbyandre@gmail.com" className="text-[#9E4F60] underline">contact the bakery</a> about delivery.</p>}
      {minimumApplies && <p className={`text-sm ${subtotalCents < options.minimum_subtotal_cents ? "text-red-700" : "text-[#796D6A]"}`}>Minimum purchase: {money(options.minimum_subtotal_cents)} before delivery fees. {subtotalCents < options.minimum_subtotal_cents ? "Please add more items to your cart." : ""}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">{delivery ? "Delivery date" : "Requested pickup date"}<input required type="date" name="fulfillment_date" value={form.fulfillment_date} onChange={update} min={options.earliest_date} max={delivery || requiredPoints>0 ? options.days.at(-1)?.date : undefined} className={input} /></label>
        <label className="text-sm font-medium">{delivery ? "Delivery time" : "Requested pickup time"}
          {scheduled ? <select required name="fulfillment_time" value={form.fulfillment_time} onChange={update} disabled={!day || Boolean(unavailable)} className={input}><option value="">Choose a time</option>{slots.map((time) => <option key={time} value={time}>{time}</option>)}</select>
            : <input required type="time" name="fulfillment_time" value={form.fulfillment_time} onChange={update} min={form.fulfillment_date === options.earliest_date ? options.earliest_time : undefined} className={input} />}
        </label>
      </div>
      <p className="text-xs leading-6 text-[#796D6A]">All times are Houston / Katy time. Please allow at least 48 hours. {scheduled ? "Times and capacity are checked again when you place the order." : "Pickup time and location will be coordinated with the bakery."}</p>
      {requiredPoints>0 && !preparationUnavailable && <p className="text-sm text-[#796D6A]">Your desserts are made to order. Preparation availability for the chosen date is checked again before payment.</p>}
      {unavailable && <p role="alert" className="text-sm text-red-700">{preparationUnavailable ? "The bakery cannot prepare this order for the selected date." : day?.closed ? "The bakery is unavailable on this date." : "All delivery places for this date are booked."} Please choose another date{delivery && !preparationUnavailable ? " or pickup" : ""}.</p>}
      {delivery && <>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#796D6A]">{options.rates.map((rate, index) => <span key={rate.up_to_miles}>{index === 0 ? "0" : `>${options.rates[index - 1].up_to_miles}`}–{rate.up_to_miles} mi: {money(rate.fee_cents)}</span>)}</div>
        <p className="text-xs leading-5 text-[#796D6A]">More than {options.rates.at(-1).up_to_miles} miles requires a custom quote. <a href="https://wa.me/17867647895" target="_blank" rel="noopener noreferrer" className="text-[#9E4F60] underline">Contact us</a> or choose pickup.</p>
        <p className="text-xs leading-5 text-[#796D6A]">Enter your delivery address below, then calculate the delivery fee.</p>
        <button type="button" onClick={calculateQuote} disabled={quoteBusy || subtotalCents < options.minimum_subtotal_cents} className="rounded-full border border-[#B76473] px-5 py-3 text-sm font-semibold text-[#9E4F60] disabled:opacity-50">{quoteBusy ? "Calculating route..." : "Calculate delivery"}</button>
        {quoteError && <p role="alert" className="text-sm text-red-700">{quoteError}</p>}
        {quote && <p role="status" className="text-sm text-green-800">Delivery: {money(quote.fee_cents)} · {quote.distance_miles.toFixed(2)} road miles. Quote valid for 15 minutes. Google Maps route distance.</p>}
      </>}
    </section>
  );
}
