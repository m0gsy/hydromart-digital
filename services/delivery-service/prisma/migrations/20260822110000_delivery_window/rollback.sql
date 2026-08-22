-- Rollback for 20260822110000_delivery_window.
-- LOSSY, but only of a snapshot: the value is a copy of `orders.deliveryWindow`, which is
-- untouched here, so nothing is unrecoverable — a re-assignment re-snapshots it. Rolling
-- back while B5b is deployed leaves the courier screen with nothing to draw, which is the
-- state B5 exists to end, so roll back the IMAGE first.
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "deliveryWindow";
