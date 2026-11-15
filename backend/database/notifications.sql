BEGIN;
-- Extend the existing outbox; never backfill or resend historical events.
ALTER TABLE order_notification_outbox DROP CONSTRAINT IF EXISTS order_notification_outbox_event_type_check;
ALTER TABLE order_notification_outbox ADD CONSTRAINT order_notification_outbox_event_type_check
  CHECK (event_type IN ('order_paid','order_confirmed','order_ready','order_completed','order_rejected','order_refunded'));
ALTER TABLE order_notification_outbox DROP CONSTRAINT IF EXISTS order_notification_outbox_status_check;
ALTER TABLE order_notification_outbox ADD CONSTRAINT order_notification_outbox_status_check
  CHECK (status IN ('pending','sending','sent','failed','uncertain','skipped'));
ALTER TABLE order_notification_outbox ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE order_notification_outbox ADD COLUMN IF NOT EXISTS claim_token UUID;
ALTER TABLE order_notification_outbox ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

CREATE OR REPLACE FUNCTION public.queue_order_transactional_email()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE notification_event TEXT;
BEGIN
  IF NEW.payment_status='refunded' AND OLD.payment_status IS DISTINCT FROM 'refunded' THEN
    notification_event := 'order_refunded';
  ELSIF NEW.order_status='refund_pending' AND OLD.order_status='pending' AND OLD.payment_status='paid' THEN
    notification_event := 'order_rejected';
  ELSIF NEW.payment_status='paid' AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
    notification_event := 'order_paid';
  ELSIF NEW.order_status IS DISTINCT FROM OLD.order_status AND NEW.payment_status='paid' THEN
    notification_event := CASE NEW.order_status
      WHEN 'confirmed' THEN 'order_confirmed' WHEN 'ready' THEN 'order_ready'
      WHEN 'completed' THEN 'order_completed' ELSE NULL END;
  END IF;
  IF notification_event IS NOT NULL AND NULLIF(BTRIM(NEW.customer_email),'') IS NOT NULL THEN
    INSERT INTO order_notification_outbox (order_id,event_type,channel)
    VALUES (NEW.id,notification_event,'email')
    ON CONFLICT (order_id,event_type,channel) DO NOTHING;
  END IF;
  -- Preserve the existing opt-in SMS events; new refund notices are email-only.
  IF notification_event IN ('order_paid','order_confirmed','order_ready','order_completed')
    AND NEW.sms_opt_in=TRUE AND NULLIF(BTRIM(NEW.customer_phone),'') IS NOT NULL THEN
    INSERT INTO order_notification_outbox (order_id,event_type,channel)
    VALUES (NEW.id,notification_event,'sms')
    ON CONFLICT (order_id,event_type,channel) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_queue_order_transactional_email ON orders;
CREATE TRIGGER trg_queue_order_transactional_email AFTER UPDATE OF payment_status,order_status ON orders
  FOR EACH ROW EXECUTE FUNCTION queue_order_transactional_email();
COMMIT;
