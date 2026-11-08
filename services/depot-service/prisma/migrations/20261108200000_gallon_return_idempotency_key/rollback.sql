-- Rolls back 20261108200000_gallon_return_idempotency_key.
-- Drops the key and its index. A double-tapped manual return can again be booked twice, which is
-- how it behaved before the column existed.
DROP INDEX IF EXISTS "gallon_returns_depotId_idempotencyKey_key";
ALTER TABLE "gallon_returns" DROP COLUMN IF EXISTS "idempotencyKey";
