import { useEffect, useState } from "react";
import {
  getAdminProduction,
  saveAdminProduction,
  saveProductProduction,
} from "../services/api";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const field =
  "mt-1 w-full rounded-lg border border-[#E7DCD9] bg-white px-3 py-2 text-sm";
const panel = "rounded-2xl border border-[#E7DCD9] bg-white p-5 sm:p-7";
const numberOrNull = (value) => (value === "" ? null : Number(value));

function ProductPreparation({ product, onSaved }) {
  const [mode, setMode] = useState(product.inventory_mode);
  const [variants, setVariants] = useState(product.variants);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await saveProductProduction(product.id, {
        inventory_mode: mode,
        variants: variants.map((v) => ({
          id: v.id,
          production_points: Number(v.production_points),
        })),
      });
      setNotice(
        "Saved. Existing orders keep their original preparation requirements.",
      );
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="rounded-xl border border-[#E7DCD9] p-4">
      <fieldset disabled={busy}>
        <legend className="sr-only">{product.name} preparation settings</legend>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div>
            <h3 className="font-serif text-xl">{product.name}</h3>
            <p className="mt-1 text-xs text-[#796D6A]">
              {product.is_available ? "Product enabled" : "Product paused"}
            </p>
          </div>
          <label className="text-sm">
            Sales mode
            <select
              className={field}
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setNotice("");
              }}
            >
              <option value="made_to_order">
                Made to order · capacity by date
              </option>
              <option value="stock">Ready to sell · units in stock</option>
            </select>
          </label>
        </div>
        {mode === "made_to_order" ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {variants.length === 0 && (
              <p className="text-sm text-[#796D6A]">
                Add variants in Products to configure preparation load.
              </p>
            )}
            {variants.map((v, index) => (
              <label key={v.id} className="rounded-lg bg-[#FAF7F5] p-3 text-xs">
                {v.label}
                <span className="mt-1 block text-[#796D6A]">
                  Preparation points per unit / package
                </span>
                <input
                  required
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  value={v.production_points}
                  className={field}
                  onChange={(e) => {
                    setVariants((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, production_points: e.target.value }
                          : item,
                      ),
                    );
                    setNotice("");
                  }}
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-[#796D6A]">
            Stock units are managed in Products → Variants. Existing stock
            values are preserved when you change sales mode; review them before
            offering ready-to-sell units.
          </p>
        )}
        <button
          type="submit"
          className="mt-4 rounded-full border border-[#B76473] px-4 py-2 text-sm font-semibold text-[#9E4F60]"
        >
          {busy ? "Saving..." : "Save product settings"}
        </button>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-3 text-sm text-green-800">
            {notice}
          </p>
        )}
      </fieldset>
    </form>
  );
}

export default function AdminProduction() {
  const [settings, setSettings] = useState(null),
    [days, setDays] = useState([]),
    [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    getAdminProduction()
      .then((data) => {
        if (active) {
          setSettings({
            version: data.settings.version,
            config: data.settings.config,
          });
          setDays(data.settings.days);
          setProducts(data.products);
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  function update(key, value) {
    setSettings((current) => ({
      ...current,
      config: { ...current.config, [key]: value },
    }));
    setNotice("");
  }
  async function refreshAvailability() {
    const data = await getAdminProduction();
    setDays(data.settings.days);
  }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await saveAdminProduction(settings);
      setSettings(data.settings);
      await refreshAvailability();
      setNotice(
        "Preparation calendar saved. Existing paid orders and active payment sessions keep their reserved capacity.",
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const config = settings?.config;
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 text-[#282323] sm:p-8">
      <div>
        <h1 className="font-serif text-4xl">Preparation &amp; capacity</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-[#796D6A]">
          Accept orders based on how much you can prepare for each fulfillment
          date. Preparation capacity applies to both pickup and delivery;
          delivery trips have their own separate limits. All dates use Houston /
          Katy time.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-green-50 p-4 text-sm text-green-800"
        >
          {notice}
        </p>
      )}
      {loading ? (
        <p>Loading preparation settings...</p>
      ) : (
        config && (
          <>
            <form onSubmit={save} className="space-y-6">
              <fieldset disabled={busy} className={panel}>
                <legend className="sr-only">Daily preparation capacity</legend>
                <h2 className="font-serif text-2xl">
                  How much can you prepare?
                </h2>
                <p className="mt-3 text-sm leading-7 text-[#796D6A]">
                  Use preparation points to compare your products. For example,
                  a small package could use 1 point and a more involved cake 3
                  points. These are internal planning values, not prices. Set
                  the points for each variant below.
                </p>
                <label className="mt-5 block max-w-sm text-sm font-medium">
                  Default preparation points per day
                  <input
                    type="number"
                    min="1"
                    max="1000000"
                    step="1"
                    placeholder="No limit until you define one"
                    className={field}
                    value={config.daily_capacity ?? ""}
                    onChange={(e) =>
                      update("daily_capacity", numberOrNull(e.target.value))
                    }
                  />
                </label>
                <p className="mt-2 text-xs text-[#796D6A]">
                  Blank means no daily limit. Ready-to-sell stock products do
                  not consume preparation points.
                </p>
              </fieldset>
              <fieldset disabled={busy} className={panel}>
                <legend className="sr-only">
                  Weekly preparation availability
                </legend>
                <h2 className="font-serif text-2xl">Weekly availability</h2>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {config.weekly_capacity.map((day, index) => (
                    <div
                      key={DAYS[index]}
                      className="grid grid-cols-[1fr_1fr] items-center gap-3 rounded-xl bg-[#FAF7F5] p-3"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={day.enabled}
                          className="accent-[#B76473]"
                          onChange={(e) =>
                            update(
                              "weekly_capacity",
                              config.weekly_capacity.map((item, i) =>
                                i === index
                                  ? { ...item, enabled: e.target.checked }
                                  : item,
                              ),
                            )
                          }
                        />
                        {DAYS[index]}
                      </label>
                      <label className="text-xs">
                        Points capacity
                        <input
                          type="number"
                          min="1"
                          max="1000000"
                          className={field}
                          placeholder="Use default"
                          value={day.capacity ?? ""}
                          onChange={(e) =>
                            update(
                              "weekly_capacity",
                              config.weekly_capacity.map((item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      capacity: numberOrNull(e.target.value),
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </fieldset>
              <fieldset disabled={busy} className={panel}>
                <legend className="sr-only">Preparation date exceptions</legend>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-serif text-2xl">
                    Blocked dates &amp; special capacity
                  </h2>
                  <button
                    type="button"
                    className="text-sm font-semibold text-[#9E4F60] underline"
                    onClick={() =>
                      update("date_overrides", [
                        ...config.date_overrides,
                        { date: "", closed: true, capacity: null, note: "" },
                      ])
                    }
                  >
                    Add date
                  </button>
                </div>
                <p className="mt-3 text-sm leading-6 text-[#796D6A]">
                  Use the fulfillment date you are accepting orders for, even if
                  you prepare some items the day before. Blocking preparation
                  does not cancel existing paid orders.
                </p>
                <div className="mt-5 space-y-3">
                  {config.date_overrides.length === 0 && (
                    <p className="text-sm text-[#796D6A]">
                      No exceptions. Weekly availability applies.
                    </p>
                  )}
                  {config.date_overrides.map((day, index) => {
                    const edit = (key, value) =>
                      update(
                        "date_overrides",
                        config.date_overrides.map((item, i) =>
                          i === index ? { ...item, [key]: value } : item,
                        ),
                      );
                    return (
                      <div
                        key={index}
                        className="grid items-end gap-3 rounded-xl bg-[#FAF7F5] p-4 sm:grid-cols-2 lg:grid-cols-4"
                      >
                        <label className="text-xs">
                          Date
                          <input
                            required
                            type="date"
                            value={day.date}
                            className={field}
                            onChange={(e) => edit("date", e.target.value)}
                          />
                        </label>
                        <label className="flex items-center gap-2 py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={day.closed}
                            className="accent-[#B76473]"
                            onChange={(e) => edit("closed", e.target.checked)}
                          />
                          Closed for preparation
                        </label>
                        <label className="text-xs">
                          Points capacity
                          <input
                            type="number"
                            min="1"
                            max="1000000"
                            disabled={day.closed}
                            placeholder="Use weekly / default"
                            value={day.capacity ?? ""}
                            className={field}
                            onChange={(e) =>
                              edit("capacity", numberOrNull(e.target.value))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="py-2 text-sm text-red-700 underline"
                          onClick={() =>
                            update(
                              "date_overrides",
                              config.date_overrides.filter(
                                (_, i) => i !== index,
                              ),
                            )
                          }
                        >
                          Remove date
                        </button>
                        <label className="text-xs sm:col-span-2 lg:col-span-4">
                          Internal note
                          <input
                            maxLength={300}
                            value={day.note}
                            className={field}
                            onChange={(e) => edit("note", e.target.value)}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-[#B76473] px-6 py-3 font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Saving..." : "Save preparation calendar"}
              </button>
            </form>
            <section className={panel}>
              <h2 className="font-serif text-2xl">Product preparation load</h2>
              <p className="mt-3 text-sm leading-7 text-[#796D6A]">
                One ordered unit or sellable package consumes the points shown
                here. Changes apply to new orders.{" "}
                <a href="#admin/products" className="text-[#9E4F60] underline">
                  Manage prices, variants and availability in Products.
                </a>
              </p>
              <div className="mt-5 space-y-4">
                {products.map((product) => (
                  <ProductPreparation
                    key={product.id}
                    product={product}
                    onSaved={refreshAvailability}
                  />
                ))}
              </div>
            </section>
            <section className={panel}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-serif text-2xl">
                  Upcoming preparation load
                </h2>
                <button
                  type="button"
                  className="text-sm text-[#9E4F60] underline"
                  onClick={() =>
                    refreshAvailability().catch((err) => setError(err.message))
                  }
                >
                  Refresh availability
                </button>
              </div>
              <p className="mt-3 text-sm leading-7 text-[#796D6A]">
                Pending orders reserve capacity for 30 minutes. Active payment
                sessions retain it until their outcome is known. Paid orders
                keep their preparation load, including after completion.
              </p>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 pr-4">Date</th>
                      <th className="pr-4">Capacity</th>
                      <th className="pr-4">Reserved / paid points</th>
                      <th>Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.slice(0, 21).map((day) => (
                      <tr key={day.date} className="border-b border-[#F1E5E2]">
                        <td className="py-3 pr-4">{day.date}</td>
                        <td className="pr-4">
                          {day.closed ? "Closed" : (day.capacity ?? "No limit")}
                        </td>
                        <td className="pr-4">{day.used}</td>
                        <td>
                          {day.closed ? "—" : (day.remaining ?? "No limit")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )
      )}
    </main>
  );
}
