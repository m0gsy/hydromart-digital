-- Rolls back 20261124120000_payment_refund_settled_at.
-- Lossy only for the marker itself; no payment amount or status is touched. The previous code
-- never read it.
ALTER TABLE "payments" DROP COLUMN IF EXISTS "refundSettledAt";
