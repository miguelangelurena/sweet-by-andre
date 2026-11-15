# Transactional email validation

The existing PostgreSQL outbox and Brevo adapter now cover payment received,
order accepted, ready, completed, rejected and refund confirmed. Each notice is
queued by an order trigger in the same transaction as its state change.
Rollback produces no notice. The unique order/event/channel key prevents duplicate
events from creating another job. Internal rejection reasons are never emailed.

`server.js` starts the opt-in worker after listening; staging uses that same
entry point. Defaults remain disabled and SMS is separate, disabled by default.
This change performs no external email sends and does not activate credentials.

## Schema and automated tests

Run `npm.cmd run test:checkout` from `backend`. The runner migrates only
`sweet_by_andre_test` and uses simulated Brevo requests. Coverage includes six
event types, rollback/deduplication, staging allowlist, historical cutoff,
concurrent workers, per-order ordering, retries, obsolete events, disabled SMS,
permanent rejection and ambiguous delivery. `npm.cmd run test:staging` validates
fresh setup and repeat deployment with the migrated outbox.

Run `npm.cmd run db:notifications` to install the additive migration locally.
Staging startup applies `database/notifications.sql` automatically. Existing
orders, notification history and provider receipts are preserved; there is no
historical event backfill. `bootstrap.sql` also includes the new schema.

## Configure a controlled staging test after deployment

1. In Brevo, configure an API key and a verified sender. Use an API key, not an
   SMTP password. Complete domain authentication as instructed by Brevo.
2. In Render Environment, configure the following, keeping sending disabled
   while saving the provider settings:

   ```dotenv
   ENABLE_TRANSACTIONAL_NOTIFICATIONS=false
   ENABLE_TRANSACTIONAL_SMS=false
   BREVO_API_KEY=<store privately in Render>
   BREVO_SENDER_EMAIL=<verified sender address>
   TRANSACTIONAL_EMAIL_ALLOWLIST=<your own test inbox address>
   NOTIFICATIONS_START_AT=<current ISO timestamp with timezone>
   ```

   The allowlist accepts comma-separated email addresses and is mandatory in
   staging. Use inboxes you control. It does not replace customer addresses:
   jobs for other recipients remain unsent. Generate the cutoff in PowerShell
   with `[DateTime]::UtcNow.ToString("o")` immediately before the test. Events
   older than the cutoff are excluded even if still pending in the queue.
3. Deploy the updated code. The Blueprint no longer resets the email flag on
   synchronization; absent/false still disables sending. Set the email flag to
   `true` only when ready to send to your own test inbox, then restart/deploy.
   No local credential file is committed or automatically imported.
4. Make a NEW Stripe sandbox purchase using exactly that test email. Leave it
   pending acceptance until the payment email arrives; the worker polls every
   minute and runs a batch at startup.
5. Accept, mark ready and complete the order separately, waiting for each email.
   The email contains the order number, total and Houston fulfillment time when
   available. Resending Stripe events must not create another outbox job.
6. With another new paid/unaccepted sandbox order, reject/refund from admin.
   Check the rejection and refund-confirmation emails in your own inbox.
7. Confirm message IDs and status in Brevo's transactional logs, including spam
   folder checks. Provider acceptance is different from inbox delivery.
8. Set `ENABLE_TRANSACTIONAL_NOTIFICATIONS=false` to stop further batches.
   SMS can remain disabled throughout. Do not enable broad production sending
   until sender authentication and these controlled tests have passed.

## Delivery behavior and operational limits

- A job is claimed atomically with `SKIP LOCKED` and a unique claim token.
  Two workers cannot send the same job or send later notices for that order
  and channel ahead of an unresolved earlier notice.
- Obsolete unsent payment/fulfillment/refund notices become `skipped`. For
  example, a ready notice is skipped if the order is already completed; a queued
  refund-confirmed notice is skipped if the refund later fails.
- `sent` means Brevo accepted the request. `provider_message_id` and the
  `X-Mailin-custom` notification ID support provider-log reconciliation.
- Explicit HTTP 429 rejection retries up to five attempts with exponential
  backoff. Permanent HTTP 4xx failures require configuration/recipient review.
- Timeouts, HTTP 5xx, unknown errors or interrupted in-flight sends become
  `uncertain`; they are NOT automatically sent again. The provider might have
  accepted them. Check its logs before manually resolving the job. There is no
  claim of exactly-once delivery across an external email provider.
- Unresolved earlier notices block later notices for the same order/channel.
  Resolve them deliberately after provider review; changing the cutoff is not
  a retry mechanism. Recipient details, keys and provider error bodies are not
  written to worker logs or `last_error`.
- The worker runs inside the backend process. Render Free can suspend that
  process; queued messages wait until it runs again. Production hosting needs
  an always-running backend or a separately scheduled worker.

## Read-only diagnosis

`npm.cmd run notifications:status` reports configuration state and grouped queue
counts without exposing keys or recipient addresses. Run it in the environment
whose queue you are inspecting; local configuration does not inspect Render.

The following SQL is diagnostic only, not a migration or retry command:

```sql
SELECT id, order_id, event_type, channel, status, attempts, retryable,
       provider_message_id, last_error, created_at, sent_at
FROM order_notification_outbox
WHERE status IN ('failed', 'uncertain')
ORDER BY created_at;
```

Manual reconciliation must verify provider logs first. If accepted, record that
receipt instead of sending again; only a confirmed rejection justifies resetting
a job for another attempt. No automatic operator recovery command is included.

Brevo references: [send transactional email](https://developers.brevo.com/docs/send-a-transactional-email),
[API request and message ID](https://developers.brevo.com/reference/send-transac-email).
