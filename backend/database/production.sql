BEGIN;
-- Keep the database default compatible with historical imports and orders.
-- The product-creation API explicitly defaults new products to made_to_order.
ALTER TABLE products ADD COLUMN IF NOT EXISTS inventory_mode TEXT NOT NULL DEFAULT 'stock'
    CHECK (inventory_mode IN ('stock','made_to_order'));
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS production_points INTEGER NOT NULL DEFAULT 1
    CHECK (production_points BETWEEN 1 AND 10000);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS inventory_mode TEXT NOT NULL DEFAULT 'stock'
    CHECK (inventory_mode IN ('stock','made_to_order'));
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS production_points INTEGER NOT NULL DEFAULT 0
    CHECK (production_points BETWEEN 0 AND 10000);
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='order_items_production_snapshot_check' AND conrelid='order_items'::regclass) THEN
        ALTER TABLE order_items ADD CONSTRAINT order_items_production_snapshot_check
            CHECK ((inventory_mode='stock' AND production_points=0) OR (inventory_mode='made_to_order' AND production_points>0));
    END IF;
END;
$migration$;
ALTER TABLE inventory_reservations ADD COLUMN IF NOT EXISTS inventory_mode TEXT NOT NULL DEFAULT 'stock'
    CHECK (inventory_mode IN ('stock','made_to_order'));

CREATE TABLE IF NOT EXISTS production_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    version INTEGER NOT NULL DEFAULT 1,
    config JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO production_settings (config) VALUES ('{
  "daily_capacity":null,
  "weekly_capacity":[{"enabled":true,"capacity":null},{"enabled":true,"capacity":null},
    {"enabled":true,"capacity":null},{"enabled":true,"capacity":null},
    {"enabled":true,"capacity":null},{"enabled":true,"capacity":null},{"enabled":true,"capacity":null}],
  "date_overrides":[]
}'::jsonb) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS production_reservations (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    service_date DATE NOT NULL,
    points INTEGER NOT NULL CHECK (points > 0),
    policy_version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','committed','released')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS production_reservations_date_idx ON production_reservations (service_date,status);

CREATE OR REPLACE FUNCTION protect_production_reservation()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF (OLD.order_id,OLD.service_date,OLD.points,OLD.policy_version)
      IS DISTINCT FROM (NEW.order_id,NEW.service_date,NEW.points,NEW.policy_version) THEN
        RAISE EXCEPTION 'Production reservation snapshots are immutable';
    END IF;
    IF OLD.status IN ('committed','released') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'A finalized production reservation cannot change state';
    END IF;
    RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_protect_production_reservation ON production_reservations;
CREATE TRIGGER trg_protect_production_reservation BEFORE UPDATE ON production_reservations
    FOR EACH ROW EXECUTE FUNCTION protect_production_reservation();

CREATE OR REPLACE FUNCTION release_cancelled_production()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF NEW.order_status = 'cancelled' AND OLD.order_status IS DISTINCT FROM 'cancelled' THEN
        UPDATE production_reservations SET status='released' WHERE order_id=NEW.id AND status='held';
    END IF;
    RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_release_cancelled_production ON orders;
CREATE TRIGGER trg_release_cancelled_production AFTER UPDATE OF order_status ON orders
    FOR EACH ROW EXECUTE FUNCTION release_cancelled_production();
COMMIT;
