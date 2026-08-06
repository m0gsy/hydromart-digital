-- Rollback for 20260717100000_add_customer_assigned_depot.
-- LOSSY: which depot each customer was assigned to is discarded. Re-assignment is manual.
DROP INDEX IF EXISTS "customers_assignedDepotId_idx";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "assignedDepotId";
