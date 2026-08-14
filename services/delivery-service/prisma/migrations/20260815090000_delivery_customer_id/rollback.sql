-- Drops the snapshot column and its index. Safe: nothing reads the column in the release
-- that adds it, and a delivery's owner can be recovered from its order at any time.
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "customerId";
