-- Rolls back 20261016120000_payment_refund_due_at.
ALTER TABLE "payments" DROP COLUMN IF EXISTS "refundDueAt";
