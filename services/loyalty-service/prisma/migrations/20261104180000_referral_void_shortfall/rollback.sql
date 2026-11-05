-- Destructive: dropping this column permanently loses recorded uncollected referral points.
-- Export the ledger and reconcile affected accounts before using this rollback.
ALTER TABLE "points_transactions" DROP COLUMN "uncollectedPoints";
