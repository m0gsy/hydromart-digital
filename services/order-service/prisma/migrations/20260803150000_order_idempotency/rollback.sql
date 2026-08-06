-- Reverses 20260803150000_order_idempotency. Drops the guard and the column it reads;
-- no other table references either, so nothing else has to be unwound. Checkout goes
-- back to accepting a retry as a second order.

DROP INDEX IF EXISTS "orders_customerId_idempotencyKey_key";

ALTER TABLE "orders" DROP COLUMN IF EXISTS "idempotencyKey";
