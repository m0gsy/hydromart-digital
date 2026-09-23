-- Rollback for 20260923140000_points_txn_actor. Drops the recorded actors with the column.
ALTER TABLE "points_transactions" DROP COLUMN IF EXISTS "createdBy";
