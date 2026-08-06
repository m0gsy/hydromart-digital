-- Rollback for 20260803090000_payment_depot_scope.
-- LOSSY: which depot each payment belongs to is discarded, so per-depot payment
-- reconciliation has nothing to group by until the column is rebuilt from the orders.
DROP INDEX IF EXISTS "payments_depotId_method_status_paidAt_idx";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "depotId";
