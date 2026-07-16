-- Manual rollback for migration 20260716130100_add_refund_approval (payment-service).
DROP INDEX IF EXISTS "payments_refundApproval_idx";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "refundApproval";
DROP TYPE IF EXISTS "RefundApproval";
