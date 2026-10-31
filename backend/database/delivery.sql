BEGIN;
CREATE TABLE IF NOT EXISTS delivery_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    version INTEGER NOT NULL DEFAULT 1,
    config JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO delivery_settings (config) VALUES ('{
  "delivery_enabled": false, "origin_address": "", "daily_limit": null,
  "minimum_subtotal_cents": 1400, "minimum_scope": "delivery",
  "pickup_same_hours": false,
  "rates": [{"up_to_miles":3,"fee_cents":500},{"up_to_miles":5,"fee_cents":700},{"up_to_miles":10,"fee_cents":1200},{"up_to_miles":15,"fee_cents":1800}],
  "weekly_hours": [
    {"enabled":true,"start":"18:00","end":"21:00"},
    {"enabled":true,"start":"18:00","end":"21:00"},
    {"enabled":true,"start":"18:00","end":"21:00"},
    {"enabled":true,"start":"18:00","end":"21:00"},
    {"enabled":true,"start":"19:00","end":"22:00"},
    {"enabled":true,"start":"19:00","end":"22:00"},
    {"enabled":true,"start":"19:00","end":"22:00"}],
  "date_overrides": []
}'::jsonb) ON CONFLICT (id) DO NOTHING;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_method TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_distance_meters INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_policy_version INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_hold_until TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS orders_delivery_service_date_idx ON orders (service_date)
    WHERE fulfillment_method = 'delivery';

CREATE TABLE IF NOT EXISTS delivery_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_cart_id UUID NOT NULL REFERENCES cart(id) ON DELETE CASCADE,
    address_hash TEXT NOT NULL,
    policy_version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed','outside_area')),
    distance_meters INTEGER,
    fee_cents INTEGER,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS delivery_quotes_cart_created_idx ON delivery_quotes (guest_cart_id, created_at);

-- Delivery snapshots become immutable together with the charged order total.
CREATE OR REPLACE FUNCTION protect_checkout_delivery()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF (OLD.fulfillment_method, OLD.fulfillment_at, OLD.service_date,
        OLD.delivery_distance_meters, OLD.delivery_policy_version)
       IS DISTINCT FROM
       (NEW.fulfillment_method, NEW.fulfillment_at, NEW.service_date,
        NEW.delivery_distance_meters, NEW.delivery_policy_version)
       AND EXISTS (SELECT 1 FROM checkout_attempts WHERE order_id = OLD.id) THEN
        RAISE EXCEPTION 'Delivery details cannot change after Checkout starts';
    END IF;
    RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_protect_checkout_delivery ON orders;
CREATE TRIGGER trg_protect_checkout_delivery BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION protect_checkout_delivery();
COMMIT;
