-- Rollback for 20260803110000_order_void.
--
-- LOSSY AND REPORT-AFFECTING: the reason an order was voided and when, both discarded.
-- Orders left in a VOIDED status keep that status but lose every trace of why — and any
-- report that excludes voided orders can no longer explain the gap.
ALTER TABLE "orders" DROP COLUMN IF EXISTS "voidedAt";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "voidReason";
