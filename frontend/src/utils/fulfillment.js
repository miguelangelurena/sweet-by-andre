export const deliveryAddressFields = [
  "shipping_street_number",
  "shipping_street",
  "shipping_city",
  "shipping_state",
  "shipping_zip_code",
];

export function hasDeliveryAddress(form) {
  return (
    deliveryAddressFields.every((name) => String(form[name] ?? "").trim()) &&
    String(form.shipping_state).trim().toUpperCase() === "TX" &&
    /^\d{5}(?:-\d{4})?$/.test(String(form.shipping_zip_code).trim())
  );
}

export const formatServiceDate = (date, weekday = "short") =>
  new Intl.DateTimeFormat("en-US", {
    weekday,
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

export const formatServiceTime = (time) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`2000-01-01T${time}:00Z`));

// This mirrors the public availability options for guidance. The backend still
// checks the date, preparation capacity, delivery capacity and prices on save.
export function fulfillmentAvailability(
  form,
  options,
  production,
  requiredPoints = 0,
) {
  const delivery = form.fulfillment_method === "delivery";
  const scheduled = delivery || Boolean(options?.pickup_same_hours);
  const day = options?.days.find((item) => item.date === form.fulfillment_date);
  const preparation = production?.days.find(
    (item) => item.date === form.fulfillment_date,
  );
  const maxDate =
    delivery || requiredPoints > 0 ? options?.days.at(-1)?.date : undefined;
  let dateError = "";
  if (form.fulfillment_date && options) {
    if (form.fulfillment_date < options.earliest_date)
      dateError = "Please choose a date at least 48 hours ahead.";
    else if (maxDate && form.fulfillment_date > maxDate)
      dateError = "Please choose a date within the current booking window.";
    else if (
      requiredPoints > 0 &&
      (!preparation ||
        preparation.closed ||
        (preparation.remaining !== null &&
          preparation.remaining < requiredPoints))
    )
      dateError =
        "The bakery cannot prepare this order on that date. Please choose another date.";
    else if (scheduled && (!day || day.closed))
      dateError =
        "The bakery is unavailable on that date. Please choose another date.";
    else if (delivery && day.remaining !== null && day.remaining <= 0)
      dateError =
        "All delivery places on that date are booked. Choose another date or pickup.";
  }
  const slots = [];
  if (scheduled && day && !dateError && day.start && day.end) {
    const [hour, minute] = day.start.split(":").map(Number);
    const [endHour, endMinute] = day.end.split(":").map(Number);
    for (
      let value = hour * 60 + minute;
      value < endHour * 60 + endMinute;
      value += 15
    ) {
      const time = `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
      if (
        form.fulfillment_date > options.earliest_date ||
        time >= options.earliest_time
      )
        slots.push(time);
    }
    if (!slots.length)
      dateError =
        "No times remain on that date with 48 hours' notice. Please choose another date.";
  }
  let timeError = "";
  if (form.fulfillment_time && !dateError && options) {
    if (scheduled && !slots.includes(form.fulfillment_time))
      timeError = "Please choose one of the available times.";
    else if (
      form.fulfillment_date === options.earliest_date &&
      form.fulfillment_time < options.earliest_time
    )
      timeError = "Please choose a later time to allow at least 48 hours.";
  }
  return { scheduled, maxDate, slots, dateError, timeError };
}
