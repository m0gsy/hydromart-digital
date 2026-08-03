-- Rollback for 20260729190000_order_walk_in.
-- LOSSY: counter sales become indistinguishable from delivery orders, so every report
-- that separates walk-in revenue from delivery revenue silently changes shape.
ALTER TABLE "orders" DROP COLUMN IF EXISTS "isWalkIn";
