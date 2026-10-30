# Checkout validation

From `backend`, run `npm.cmd run test:checkout` on Windows (or `npm run test:checkout`).
The command uses connection settings from `.env`, overrides the database to
`sweet_by_andre_test`, and refuses schema setup against any other database.
That database must already contain the application's base schema. The setup
adds the order request and notification tables missing from the older test DB.
It does not change `.env` or the development database.

The suite uses mocked Stripe API calls and locally signed webhook events. It
does not contact Stripe or send customer notifications. It checks:

- Guest cart creation, CSRF, order submission, and duplicate submission recovery.
- Checkout creation and reuse of the same session.
- Rejection of invalid webhook signatures and access by another guest.
- Payment confirmation and a duplicate webhook without double stock deduction.
- Visibility of the paid order in administration and progression through
  confirmed, preparing, ready, and completed.
- Exactly one queued email per applicable event, with SMS opt-out respected.
- Checkout expiration and inventory reservation release.

## Manual Stripe test still required

1. Start the backend and frontend. Use the exact origin in `FRONTEND_URL`
   (currently `http://localhost:5173`). If Vite selects another port, resolve
   the occupied port before testing; the backend rejects other origins.
2. Verify that the backend Stripe key is a test key, both checkout flags are
   enabled, and Stripe test events reach `/api/payments/webhook`. The webhook
   signing secret must match the endpoint or local forwarding session.
3. Add a product with available stock, enter contact and delivery details at
   least 48 hours ahead, create the order, and open Stripe Checkout.
4. Complete Checkout with a Stripe test payment method. Confirm the browser
   returns to the expected origin and the backend reports the order as paid.
   The current result page checks status once; reload if the webhook arrives
   after that check.
5. Confirm the same order appears paid in administration, stock decreases by
   the purchased quantity once, and fulfillment can advance through all stages.
6. With a separate order, cancel Checkout and return to the order. Retry and
   verify that its open session is reused and the order stays unpaid until a
   payment webhook is processed.

Automated results do not verify Stripe credentials, external webhook delivery,
browser cookies, redirects, or the visual checkout flow.

The frontend build passes. The full frontend lint check currently reports
existing React hook errors in multiple components; those remain separate work.
