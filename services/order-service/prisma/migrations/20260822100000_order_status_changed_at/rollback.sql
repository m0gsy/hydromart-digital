-- Rollback for 20260822100000_order_status_changed_at.
-- LOSSY: discards when each order last changed status. Nothing else stores it in one place
-- — it can be recomputed from "order_status_history", but only for orders whose history has
-- not been pruned. Rolling back while B3b is deployed puts the sweep back on `createdAt`,
-- which is the bug B3 exists to fix, so roll back the IMAGE first.
ALTER TABLE "orders" DROP COLUMN IF EXISTS "statusChangedAt";
