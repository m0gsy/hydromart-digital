-- Rolls back 20261014120000_payment_refund_requested_by.
ALTER TABLE "payments" DROP COLUMN IF EXISTS "refundRequestedBy";
