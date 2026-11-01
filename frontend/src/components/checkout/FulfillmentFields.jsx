import {
  fulfillmentAvailability,
  formatServiceDate,
  formatServiceTime,
  hasDeliveryAddress,
} from "../../utils/fulfillment";

const money = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const input =
  "mt-2 min-w-0 w-full rounded-xl border border-[#E7DCD9] bg-white px-3 py-3 text-base";

export default function FulfillmentFields({
  form,
  update,
  options,
  production,
  requiredPoints = 0,
  quote,
  quoteBusy,
  quoteError,
  calculateQuote,
  subtotalCents,
  children,
}) {
  const delivery = form.fulfillment_method === "delivery";
  const zipPricing = options.pricing_method === "zip_code";
  const { scheduled, maxDate, slots, dateError, timeError } =
    fulfillmentAvailability(form, options, production, requiredPoints);
  const minimumApplies = delivery || options.minimum_scope === "all";
  const belowMinimum =
    minimumApplies && subtotalCents < options.minimum_subtotal_cents;
  const suggestedDates = options.days
    .filter(
      (day) =>
        day.date >= options.earliest_date &&
        !fulfillmentAvailability(
          { ...form, fulfillment_date: day.date, fulfillment_time: "" },
          options,
          production,
          requiredPoints,
        ).dateError,
    )
    .slice(0, 3);

  return (
    <section
      aria-labelledby="fulfillment-title"
      className="border-t border-[#E7DCD9] pt-6"
    >
      <h2 id="fulfillment-title" className="font-serif text-2xl">
        2. Pickup or delivery
      </h2>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {["pickup", "delivery"].map((method) => {
          const disabled = method === "delivery" && !options.delivery_available;
          return (
            <label
              key={method}
              className={`flex items-start gap-2 rounded-2xl border p-3 text-sm sm:p-4 ${form.fulfillment_method === method ? "border-[#B76473] bg-[#FFF5F5]" : "border-[#E7DCD9] bg-white"} ${disabled ? "opacity-55" : ""}`}
            >
              <input
                type="radio"
                name="fulfillment_method"
                value={method}
                checked={form.fulfillment_method === method}
                onChange={update}
                disabled={disabled}
                className="mt-1 h-4 w-4 shrink-0 accent-[#B76473]"
              />
              <span>
                <strong className="block">
                  {method === "pickup" ? "Pickup" : "Delivery"}
                </strong>
                <span className="mt-1 block text-xs leading-5 text-[#796D6A]">
                  {method === "pickup"
                    ? "Free · arranged with Andrea"
                    : zipPricing
                      ? "Fixed fee by ZIP code"
                      : "Fee based on your address"}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {!options.delivery_available && (
        <p className="mt-3 text-sm leading-6 text-[#796D6A]">
          Delivery booking is currently unavailable. Choose pickup or{" "}
          <a
            href="mailto:sweetbyandre@gmail.com"
            className="text-[#9E4F60] underline"
          >
            contact us
          </a>{" "}
          to ask about delivery.
        </p>
      )}
      {minimumApplies && (
        <p
          className={`mt-3 text-sm leading-6 ${belowMinimum ? "text-red-700" : "text-[#796D6A]"}`}
        >
          {money(options.minimum_subtotal_cents)} minimum in desserts, before
          delivery.{" "}
          {belowMinimum && (
            <>
              <a href="/#cart" className="font-semibold underline">
                Add {money(options.minimum_subtotal_cents - subtotalCents)} more
              </a>{" "}
              {delivery && options.minimum_scope !== "all"
                ? "or choose pickup."
                : "to continue."}
            </>
          )}
        </p>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-semibold">
          {delivery
            ? "When should we deliver?"
            : "When would you like to pick up?"}
        </h3>
        <p id="schedule-help" className="mt-1 text-sm leading-6 text-[#796D6A]">
          Please order at least 48 hours ahead. All times are Houston / Katy
          time.
        </p>
        {suggestedDates.length > 0 && (
          <div
            role="group"
            aria-label="Suggested available dates"
            className="mt-3 flex flex-wrap gap-2"
          >
            {suggestedDates.map((day) => (
              <button
                key={day.date}
                type="button"
                aria-pressed={form.fulfillment_date === day.date}
                onClick={() =>
                  update({
                    target: { name: "fulfillment_date", value: day.date },
                  })
                }
                className={`min-h-11 rounded-full border px-3 py-2 text-xs ${form.fulfillment_date === day.date ? "border-[#B76473] bg-[#B76473] text-white" : "border-[#E7DCD9] bg-white text-[#796D6A]"}`}
              >
                {formatServiceDate(day.date)}
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-medium">
            {delivery ? "Delivery date" : "Requested pickup date"}
            <input
              required
              type="date"
              name="fulfillment_date"
              value={form.fulfillment_date}
              onChange={update}
              min={options.earliest_date}
              max={maxDate}
              aria-describedby={
                dateError ? "schedule-help schedule-error" : "schedule-help"
              }
              aria-invalid={Boolean(dateError)}
              className={input}
            />
          </label>
          <label className="min-w-0 text-sm font-medium">
            {delivery ? "Delivery time" : "Preferred pickup time"}
            {scheduled ? (
              <select
                required
                name="fulfillment_time"
                value={form.fulfillment_time}
                onChange={update}
                disabled={!form.fulfillment_date || Boolean(dateError)}
                aria-invalid={Boolean(timeError)}
                aria-describedby={
                  timeError ? "schedule-help schedule-error" : "schedule-help"
                }
                className={input}
              >
                <option value="">
                  {!form.fulfillment_date
                    ? "Choose a date first"
                    : dateError
                      ? "Choose another date"
                      : "Choose a time"}
                </option>
                {slots.map((time) => (
                  <option key={time} value={time}>
                    {formatServiceTime(time)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                required
                type="time"
                name="fulfillment_time"
                value={form.fulfillment_time}
                onChange={update}
                min={
                  form.fulfillment_date === options.earliest_date
                    ? options.earliest_time
                    : undefined
                }
                aria-invalid={Boolean(timeError)}
                aria-describedby={
                  timeError
                    ? "schedule-help pickup-help schedule-error"
                    : "schedule-help pickup-help"
                }
                className={input}
              />
            )}
          </label>
        </div>
        {!scheduled && (
          <p
            id="pickup-help"
            className="mt-3 rounded-xl bg-[#FAF7F5] p-3 text-sm leading-6 text-[#796D6A]"
          >
            Your preferred time is a request. Andrea will coordinate the pickup
            time and location with you.
          </p>
        )}
        {(dateError || timeError) && (
          <p
            id="schedule-error"
            role="alert"
            className="mt-3 text-sm leading-6 text-red-700"
          >
            {dateError || timeError}
          </p>
        )}
      </div>

      {delivery && (
        <div className="mt-6 border-t border-[#E7DCD9] pt-6">
          <h3 className="font-serif text-2xl">Delivery address</h3>
          <p className="mt-2 text-sm leading-6 text-[#796D6A]">
            {zipPricing
              ? "Enter your delivery address to check the fixed fee for your ZIP code. Andrea will confirm the address with you."
              : "Enter your address to check the route and delivery fee."}
          </p>
          <div className="mt-4">{children}</div>
          <button
            type="button"
            onClick={calculateQuote}
            disabled={quoteBusy || belowMinimum || !hasDeliveryAddress(form)}
            className="mt-4 min-h-11 w-full rounded-full border border-[#B76473] px-4 py-3 text-sm font-semibold text-[#9E4F60] disabled:opacity-50"
          >
            {quoteBusy
              ? "Checking delivery fee..."
              : quote
                ? "Recalculate delivery fee"
                : "Check delivery fee"}
          </button>
          {!hasDeliveryAddress(form) && (
            <p className="mt-2 text-xs leading-5 text-[#796D6A]">
              Complete the street number, street, city, Texas state and ZIP code
              to check delivery.
            </p>
          )}
          {quoteError && (
            <div role="alert" className="mt-3 text-sm leading-6 text-red-700">
              {quoteError}
              <a
                href="mailto:sweetbyandre@gmail.com"
                className="mt-1 inline-flex min-h-11 items-center font-semibold text-[#9E4F60] underline"
              >
                Contact Andrea for help or a custom quote
              </a>
            </div>
          )}
          {quote && (
            <div
              role="status"
              className="mt-3 rounded-xl bg-green-50 p-4 text-sm leading-6 text-green-900"
            >
              <strong>Delivery fee: {money(quote.fee_cents)}</strong>
              <span className="block">
                {quote.pricing_method === "zip_code"
                  ? `Fixed fee for ZIP ${quote.destination_zip_code}`
                  : `${Number(quote.distance_miles).toFixed(2)} road miles · Google Maps`}
              </span>
              <span className="block text-xs">
                Valid until{" "}
                {new Intl.DateTimeFormat("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "America/Chicago",
                }).format(new Date(quote.expires_at))}
                , Houston time.
              </span>
            </div>
          )}
          <details className="mt-4 text-sm text-[#796D6A]">
            <summary className="py-2 font-medium text-[#9E4F60]">
              Delivery rates &amp; service area
            </summary>
            <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
              {zipPricing
                ? (options.zip_rates ?? []).map((rate) => (
                    <li
                      key={rate.zip_code}
                      className="flex justify-between gap-3"
                    >
                      <span>
                        ZIP {rate.zip_code}
                        {rate.label ? ` · ${rate.label}` : ""}
                      </span>
                      <span>{money(rate.fee_cents)}</span>
                    </li>
                  ))
                : options.rates.map((rate, index) => (
                    <li
                      key={rate.up_to_miles}
                      className="flex justify-between gap-3"
                    >
                      <span>
                        {index === 0
                          ? "0"
                          : `Over ${options.rates[index - 1].up_to_miles}`}
                        –{rate.up_to_miles} miles
                      </span>
                      <span>{money(rate.fee_cents)}</span>
                    </li>
                  ))}
            </ul>
            <p className="mt-3 leading-6">
              {zipPricing
                ? "ZIP code not listed?"
                : `Beyond ${options.rates.at(-1)?.up_to_miles} miles?`}{" "}
              <a
                href="https://wa.me/17867647895"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#9E4F60] underline"
              >
                Ask for a custom quote
              </a>{" "}
              or choose pickup.
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
