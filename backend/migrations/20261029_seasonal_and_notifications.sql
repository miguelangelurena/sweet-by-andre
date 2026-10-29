-- Sweet by André: seasonal collections + durable transactional notification queue.
-- Apply ONCE to sweet_by_andre_dev. Backup before applying.
-- Repeat against the actual production database only after validation.
BEGIN;
CREATE TABLE IF NOT EXISTS seasonal_collections (
    slug TEXT PRIMARY KEY CHECK (slug IN ('valentines', 'thanksgiving', 'christmas')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO seasonal_collections (slug, title, description) VALUES
 ('valentines', 'Valentine''s Day', 'Made for someone special.'),
 ('thanksgiving', 'Thanksgiving', 'Something sweet for the gathering.'),
 ('christmas', 'Christmas', 'Celebrate the season with handmade desserts.')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS seasonal_collection_products (
    collection_slug TEXT NOT NULL REFERENCES seasonal_collections(slug) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_slug, product_id)
);
CREATE INDEX IF NOT EXISTS seasonal_products_product_idx ON seasonal_collection_products(product_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS order_notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id),
    event_type TEXT NOT NULL CHECK (event_type IN ('order_paid', 'order_confirmed', 'order_ready', 'order_completed')),
    channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, event_type, channel)
);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
 ON order_notification_outbox(status, next_attempt_at);

CREATE OR REPLACE FUNCTION queue_order_transactional_email()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE notification_event TEXT;
BEGIN
    notification_event := NULL;
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
        INSERT INTO order_notification_outbox(order_id, event_type, channel)
        VALUES (NEW.id, notification_event, 'email')
        ON CONFLICT (order_id, event_type, channel) DO NOTHING;
    END IF;
    -- SMS is only queued when the customer explicitly opted in.
    IF notification_event IS NOT NULL AND NEW.sms_opt_in = TRUE AND NULLIF(BTRIM(NEW.customer_phone), '') IS NOT NULL THEN
        INSERT INTO order_notification_outbox(order_id, event_type, channel)
        VALUES (NEW.id, notification_event, 'sms')
        ON CONFLICT (order_id, event_type, channel) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_queue_order_transactional_email ON orders;
CREATE TRIGGER trg_queue_order_transactional_email
AFTER UPDATE OF payment_status, order_status ON orders
FOR EACH ROW EXECUTE FUNCTION queue_order_transactional_email();
COMMIT;
-- This does not send any messages. Email worker is OFF by default.
