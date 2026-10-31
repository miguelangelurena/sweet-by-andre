import { DeliveryError } from "./deliveryPolicy.service.js";

// Only the server calls Routes API. Never accept miles or a fee from the browser.
export const roadDistance = {
  async measure(origin, destination) {
    const key = process.env.GOOGLE_ROUTES_API_KEY;
    if (!key) throw new DeliveryError("Delivery quotes are not available yet. Please choose pickup or contact the bakery", "DELIVERY_NOT_CONFIGURED", 503);
    let response;
    try {
      response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST", signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.distanceMeters" },
        body: JSON.stringify({ origin: { address: origin }, destination: { address: destination },
          travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE", computeAlternativeRoutes: false }),
      });
    } catch { throw new DeliveryError("Could not calculate the route. Try again or contact the bakery", "DELIVERY_ROUTE_UNAVAILABLE", 503); }
    if (!response.ok) throw new DeliveryError("Could not calculate the route. Try again or contact the bakery", "DELIVERY_ROUTE_UNAVAILABLE", 503);
    const data = await response.json();
    const distance = data.routes?.[0]?.distanceMeters;
    if (!Number.isSafeInteger(distance) || distance < 0) throw new DeliveryError("No driving route found. Check the address or contact the bakery", "DELIVERY_NO_ROUTE", 422);
    return distance;
  },
};
