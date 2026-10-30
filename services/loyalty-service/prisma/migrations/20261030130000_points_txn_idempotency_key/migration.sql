-- RERUNNABLE: ADD COLUMN IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS.
-- A reward granted by another service (the birthday sweep) is stamped with a key the caller
-- derives from WHAT it is rewarding ("birthday:2026"). The ledger row and the key are one
-- write, so a sweep that re-runs after the marker on the customer side was lost cannot grant
-- the points twice. NULL = no key (every existing row, every EARN/ADJUST/EXPIRE), and NULLs
-- are distinct in a unique index, so this constrains nothing that already exists.
-- Index name for scripts/check-index-concurrency.mjs: points_transactions_customerId_idempotencyKey_key
-- It is built here, not in create-indexes.sh: the column is created by this very migration (a
-- concurrent build registered there fails on a column that does not exist yet) and every value
-- is NULL, so the build is instant.
ALTER TABLE "points_transactions" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_customerId_idempotencyKey_key"
  ON "points_transactions" ("customerId", "idempotencyKey");
