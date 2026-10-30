ALTER TABLE orders ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS order_creation_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_type TEXT NOT NULL CHECK (identity_type IN ('guest', 'user')),
    identity_id UUID NOT NULL,
    idempotency_key UUID NOT NULL,
    payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    order_id UUID UNIQUE REFERENCES orders(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (identity_type, identity_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS order_notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id),
    event_type TEXT NOT NULL CHECK (event_type IN ('order_paid', 'order_confirmed', 'order_ready', 'order_completed')),
    channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, event_type, channel)
);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
    ON order_notification_outbox (status, next_attempt_at);

CREATE OR REPLACE FUNCTION public.queue_order_transactional_email()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE notification_event TEXT;
BEGIN
    IF NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
        notification_event := 'order_paid';
    ELSIF NEW.order_status IS DISTINCT FROM OLD.order_status AND NEW.payment_status = 'paid' THEN
        notification_event := CASE NEW.order_status
            WHEN 'confirmed' THEN 'order_confirmed'
            WHEN 'ready' THEN 'order_ready'
            WHEN 'completed' THEN 'order_completed'
            ELSE NULL END;
    END IF;
    IF notification_event IS NOT NULL AND NULLIF(BTRIM(NEW.customer_email), '') IS NOT NULL THEN
        INSERT INTO order_notification_outbox (order_id, event_type, channel)
        VALUES (NEW.id, notification_event, 'email')
        ON CONFLICT (order_id, event_type, channel) DO NOTHING;
    END IF;
    IF notification_event IS NOT NULL AND NEW.sms_opt_in = TRUE AND NULLIF(BTRIM(NEW.customer_phone), '') IS NOT NULL THEN
        INSERT INTO order_notification_outbox (order_id, event_type, channel)
        VALUES (NEW.id, notification_event, 'sms')
        ON CONFLICT (order_id, event_type, channel) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_queue_order_transactional_email ON orders;
CREATE TRIGGER trg_queue_order_transactional_email
    AFTER UPDATE OF payment_status, order_status ON orders
    FOR EACH ROW EXECUTE FUNCTION queue_order_transactional_email();
