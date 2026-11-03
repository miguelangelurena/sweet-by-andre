BEGIN;
-- Preserve historical rows and immutable reservation snapshots.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('pending','partial','paid','failed','refund_pending','refunded'));
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS requested_by UUID;
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='refund_requests'::regclass AND conname='refund_requests_requested_by_fkey') THEN
    ALTER TABLE refund_requests ADD CONSTRAINT refund_requests_requested_by_fkey
      FOREIGN KEY (requested_by) REFERENCES users(id);
  END IF;
END;
$migration$;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS resources_returned_at TIMESTAMPTZ;
COMMIT;
