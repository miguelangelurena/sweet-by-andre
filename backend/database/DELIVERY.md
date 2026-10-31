# Delivery and pickup

Run `npm.cmd run db:delivery` from `backend` to install the additive schema in
the local development database. `npm.cmd run test:checkout` prepares the isolated
test database and runs delivery and payment validation. The installer is
restricted to `sweet_by_andre_dev` and `sweet_by_andre_test`; production schema
changes must be applied through the deployment's migration process.

## Administration

Open `/#admin/delivery`. Session authentication, administrator access and session
CSRF protect settings changes. The version number prevents a stale form from
overwriting another administrator's changes.

Defaults:

| One-way driving distance | Fee |
| --- | --- |
| 0 through 3 miles | $5 |
| Above 3 through 5 miles | $7 |
| Above 5 through 10 miles | $12 |
| Above 10 through 15 miles | $18 |
| Above 15 miles | Contact the bakery for a custom quote, or select pickup |

Delivery requires a $14 merchandise subtotal, before delivery fees. Pickup has
no delivery fee and no minimum. Both require 48 hours' notice. Pickup time and
location are requests to arrange directly with the bakery.

Delivery windows are Sunday–Wednesday 18:00–21:00 and Thursday–Saturday
19:00–22:00, in America/Chicago, including daylight saving changes. Opening is
inclusive and closing exclusive. A date exception overrides the weekly hours;
it can close a date, change its hours, or set a different daily delivery limit.
Blank daily limits mean unlimited deliveries. Limits count orders/trips, not
product units. Stock remains a separate per-variant inventory constraint.

Existing paid orders and active Stripe sessions retain their arrangements.
Schedule changes stop new bookings; they do not silently cancel an existing
customer's payment. The administrator must coordinate changes to booked orders.
Unpaid orders that have not started payment are checked again before Checkout.

## Driving-distance configuration

The departure address is stored only in administrator settings. It is not in
source control or the public options response. The confirmed local origin was
saved in the development database; delivery remains disabled until routing is
configured and the administrator enables it.

Configure `GOOGLE_ROUTES_API_KEY` only in the backend environment, enable the
Google Routes API for that key, and restart the backend. Google Maps billing
and appropriate API/key restrictions must be configured in the owner's Google
Cloud account. No account, billing subscription, or API key is provisioned by
this implementation. See the official [Compute Routes documentation](https://developers.google.com/maps/documentation/routes/compute_route_directions).

The server requests `DRIVE`, `TRAFFIC_UNAWARE`, and only `routes.distanceMeters`.
There is no straight-line or ZIP-centroid fallback. Failed routing leaves the
fee unquoted; it never produces a free delivery. Distances are compared before
rounding, using 1609.344 meters per mile. The checkout shows Google Maps as the
route-distance source.

Quotes last 15 minutes and belong to the guest cart, normalized address, and
settings version. Same-address quotes are cached within that validity window;
each guest cart is limited to ten new attempts in ten minutes. Only the server
can set distance and price. Cart totals and the $14 delivery minimum are
validated again during order creation. Changes to prices or the departure
address invalidate outstanding quotes. An order that was already created keeps
its quoted shipping cost; new orders use the updated prices.

## Capacity and payment

The settings row is locked inside order creation so two buyers cannot reserve
the same last delivery place, including buyers purchasing different variants.
Unpaid orders hold a place for 30 minutes. Starting Stripe extends the hold for
that Checkout session. Active creating/open attempts continue to count until
their remote outcome is known; a clock alone must not release an ambiguous
payment. A signed expiration event releases the delivery place and inventory
reservations. A paid order keeps its daily place, including when fulfilled.
Cancellation of a never-started unpaid order releases its place immediately.

The order stores fulfillment method, an authoritative timestamp, the Houston
service date, distance, policy version, and charged shipping cost. Payment
verification uses the complete server-calculated order total. Fulfillment
snapshots cannot be edited after a Checkout attempt exists.

If an unpaid delivery hold expires before payment starts, the customer must
start a new order with a new quote. The bakery can cancel the unpaid original
from administration. Pickup remains available while delivery is disabled.
Historical orders are marked `legacy`; no delivery price or stock is rewritten.

Tax rules remain a separate outstanding configuration; this change implements
fulfillment fees, not sales tax.

## Validation

The suite tests every price boundary, Houston daylight offsets, minimum notice,
closing hours, date exceptions, minimum purchase scope, protected administrator
access, private-origin handling, stale settings, quote ownership/address changes,
two buyers racing for one last place on different inventory rows, fee snapshots
sent to Stripe, expired payment slot release, and paid-order capacity retention.
Google Routes and Stripe are mocked in automated tests. A real driving quote
still requires the owner's configured routing key and a manual browser check.
