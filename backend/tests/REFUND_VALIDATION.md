# Rejection and full refunds (sandbox rollout)

Administrative rejection is limited to a paid order still awaiting acceptance.
It requires an administrator session, session CSRF, a reason, and explicit
confirmation of the full order total. Accepted/preparing/completed orders,
partial refunds and refunds initiated separately in Stripe require manual review.

## Enable locally

1. Run `npm.cmd run db:refunds` from `backend`. This repeatable migration only
   supports the development/test databases. It preserves historical rows,
   widens the order payment states and adds refund audit fields.
2. Set `ENABLE_ADMIN_REFUNDS=true` in `backend/.env` and restart the backend.
   The route additionally requires a `sk_test_` key. Live refunds remain disabled
   even if the flag is set. No frontend build flag is needed.
3. Keep `npm.cmd run stripe:listen` running for local refund event delivery.

## Enable in Render staging after publishing this change

`initializeStaging.js` applies `database/refunds.sql` after the existing migrations
on startup. Existing orders, catalog edits and users are preserved. Add
`refund.created`, `refund.updated` and `refund.failed` to the existing snapshot webhook destination in the same Stripe
sandbox. Keep the endpoint signing secret configured in Render.

Set `ENABLE_ADMIN_REFUNDS=true` in Render only with the staging test key, then
deploy the updated code. Email/SMS remain subject to their existing flags; this
change does not send rejection/refund notifications.

## Manual test

1. Create and pay a NEW staging order using a Stripe test card. Do not accept it.
2. Record its order ID, total, physical variant stock (if applicable), and the
   preparation load for its service date. Use pickup first.
3. In Orders, open Refund review and click Check refund status. Enter a reason,
   click Reject and refund in full and confirm the exact amount/order.
4. During processing the order/payment are `refund_pending`; acceptance is
   blocked. A timeout keeps the durable request. Check status and use Retry
   existing refund rather than issuing a separate refund in Stripe.
5. Only a verified successful Stripe refund sets the order to `cancelled`,
   the order/payment to `refunded`, and the request to `succeeded`.
6. Confirm a single full refund in Stripe. Inspect `refund.created` and subsequent
   refund event deliveries. An immediate successful API response can finalize the
   same request before that event; the two paths share the transactional logic.
7. Verify physical stock is returned once for stock-mode order snapshots.
   Made-to-order variants never gain artificial stock. Cancelled orders no
   longer consume preparation/delivery capacity, while committed reservation
   snapshots remain intact as historical evidence.
8. Resend the refund event and verify no additional stock/capacity change.
   A late completed-payment event must also leave the refunded order unchanged.
9. A failed refund stays blocked for manual review and retains its resources.
   No second refund request or replacement key is automatically created.
   If failure arrives after prior success, the order remains cancelled but its
   payment is flagged `refund_pending` for manual review. Resources already
   returned are not reversed or returned again; stale events cannot hide failure.

If forwarding was absent after an uncertain API response, retrying the existing
request retrieves its linked refund or finds it by request metadata. Ambiguous
refund history is blocked. There is no background refund worker in this change.

## Automated verification

`npm.cmd run test:checkout` initializes only `sweet_by_andre_test`, runs the
checkout regressions, refund service tests and `refund-workflow.http.test.js`.
Stripe is mocked; HTTP middleware, signatures, PostgreSQL and transactions are
real. Tests cover authorization/CSRF, disabled/live-key guards, invalid amounts,
early/duplicate/out-of-order events, API response loss, retry idempotency,
acceptance racing rejection, stock and preparation load, and late payment events.

`npm.cmd run test:staging` verifies fresh setup and repeat deployment preserve
data with the new schema. Automated tests do not prove external Stripe delivery.

Stripe references: [refund creation](https://docs.stripe.com/api/refunds/create),
[refund states](https://docs.stripe.com/api/refunds/object).
[Refund lifecycle events](https://docs.stripe.com/refunds#refund-events).
