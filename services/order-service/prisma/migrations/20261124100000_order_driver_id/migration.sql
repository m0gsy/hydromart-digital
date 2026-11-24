-- RERUNNABLE: HD-6 A5 (2026-11-24). Additive and nullable: the courier id the order was
-- assigned to. No backfill - orders made before this keep only driverName.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "driverId" UUID;
