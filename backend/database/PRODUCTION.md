# Made-to-order preparation

Run `npm.cmd run db:production` from `backend`, after the delivery schema is
installed. The additive migration preserves historical orders, inventory
reservations, stock quantities, and payments. It is restricted to the local
development/test databases; apply the SQL through the production migration
process when deploying.

The initial business catalog can be switched with
`npm.cmd run db:production -- --convert-catalog`. This explicit one-time command
is restricted to development. It changes product sales modes only. Future
mode changes should be made per product in administration.

## Owner controls

`/#admin/production` contains:

- A default daily preparation capacity, measured in internal points. Blank
  means unlimited until the owner chooses a practical limit.
- Weekly availability and capacity overrides.
- Blocked fulfillment dates and special date capacities.
- A sales mode for each product: made to order or ready-to-sell stock.
- Preparation points for each sellable variant unit/package. The initial
  neutral value is 1; the owner can assign more points to more demanding items.
- Upcoming reserved and paid preparation load, separate from delivery trips.

Points are not prices, customer-visible stock counts, or a promise of unlimited
production. For example, a package can consume 1 point and a complex cake 3;
the owner chooses a daily limit that reflects the actual workload. A quantity
of 2 of a 3-point variant consumes 6 points. The unit is whatever one purchase
quantity represents, including a package of multiple desserts.

Preparation is booked against the customer's fulfillment date, for both
pickup and delivery. This first version does not plan separate baking tasks
across preceding days. All dates use America/Chicago. The existing 48-hour
notice, delivery rates, delivery minimum, and pickup coordination still apply.
The checkout currently offers date availability for the next 60 days.

## Compatibility and snapshots

Existing database/imported products retain the legacy `stock` database default.
The product-creation API defaults new products to `made_to_order`. This keeps
older imports and automated inventory fixtures explicit and compatible.

Old order items and inventory reservations receive a `stock` snapshot with
zero preparation points. New orders snapshot product mode and variant points.
Changing the catalog afterward never rewrites those snapshots. Stock units
are deducted only for reservations whose snapshot is `stock`; made-to-order
items still have item reservations for payment integrity but do not decrement
physical units. Mixed orders support both behaviors in the same transaction.

Before switching a product back to ready-to-sell mode, the owner should review
its preserved variant stock quantities. Made-to-order sales do not decrement
those numbers. Catalog availability and variant pause switches remain in
Products; made-to-order variants can be sold with stock zero.

## Reservation lifecycle

During order creation, the server computes quantity × preparation points from
trusted variants and reserves date capacity for 30 minutes. The transaction
rolls back completely if the order cannot fit. A locked production settings
row prevents competing buyers on different stock rows from overbooking a day.
The lock order is variants → delivery settings → production settings.

Starting a new Stripe session rechecks preparation availability and extends
the hold for that session. Active creating/open sessions continue consuming
capacity until their outcome is known. Existing active sessions can resume
after a calendar edit; existing paid orders are never silently cancelled by
a schedule change.

A verified paid webhook commits preparation together with the payment and
item reservations. Duplicate events do not consume capacity or stock twice.
Completed paid orders retain their workload for the fulfillment date. A
signed checkout expiration releases held preparation, and cancelling a
never-started unpaid order releases it through a database trigger. A clock
alone never releases a reservation tied to an uncertain active payment.

Expired holds that never started payment stop counting and cannot start a
new session. Checkout offers the customer a fresh order/availability check.
Stock-only orders do not require a production reservation and retain the
existing inventory lifecycle.

## Verification

`npm.cmd run test:checkout` includes isolated tests for preparation defaults,
date and weekly rules, weighted competing orders on separate inventory rows,
different fulfillment dates, made-to-order products with zero stock, mixed
orders, catalog-mode changes after order creation in both directions, blocked
dates before versus during Checkout, duplicate paid events, payment expiration,
unpaid cancellation, and immutable workload snapshots. It also runs the
existing payment/delivery suite and legacy inventory concurrency, integrity,
rollback and reservation tests. Stripe and routing calls are mocked.
