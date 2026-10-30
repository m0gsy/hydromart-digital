DROP INDEX IF EXISTS "points_transactions_customerId_idempotencyKey_key";
ALTER TABLE "points_transactions" DROP COLUMN IF EXISTS "idempotencyKey";
