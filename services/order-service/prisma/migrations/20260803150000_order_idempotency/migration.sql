-- B-13: checkout idempotency. A double tap, or a retry after the proxy timed out on a
-- request the server had already committed, used to create a second order. The key is
-- client-supplied per checkout attempt; the unique index is what makes the second write
-- lose. NULLs are distinct in Postgres, so rows written by paths that send no key
-- (subscription sweeps, backfills, everything already in the table) are unaffected.
-- Additive, non-destructive.

ALTER TABLE "orders" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "orders_customerId_idempotencyKey_key"
  ON "orders" ("customerId", "idempotencyKey");
