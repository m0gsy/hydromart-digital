DROP INDEX IF EXISTS "courier_withdrawals_courierId_idempotencyKey_key";
DROP INDEX IF EXISTS "withdrawals_franchiseOwnerId_idempotencyKey_key";
ALTER TABLE "courier_withdrawals" DROP COLUMN IF EXISTS "idempotencyKey";
ALTER TABLE "withdrawals" DROP COLUMN IF EXISTS "idempotencyKey";
