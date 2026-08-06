-- Rollback for 0007_add_order_refunded_amount.
-- LOSSY AND FINANCIAL: how much has been refunded against each order is discarded, so a
-- partially refunded order reads as fully collected. Reconcile against payment-service
-- before running this.
ALTER TABLE "orders" DROP COLUMN IF EXISTS "refundedAmount";
