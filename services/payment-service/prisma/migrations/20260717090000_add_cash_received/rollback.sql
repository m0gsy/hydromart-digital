-- Manual rollback for migration 20260717090000_add_cash_received (payment-service).
ALTER TABLE "payments" DROP COLUMN IF EXISTS "changeGiven";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "cashReceived";
