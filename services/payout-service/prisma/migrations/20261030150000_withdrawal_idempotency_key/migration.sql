-- RERUNNABLE: ADD COLUMN IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS.
-- A withdrawal request carries the caller's Idempotency-Key (one per attempt, the same across every
-- retry of it). Two taps, or an offline retry whose first answer was lost, used to create TWO
-- withdrawals whenever the balance covered both. The key makes the second one return the first.
-- NULL = no key (every existing row, every caller that sends none); NULLs are distinct in a unique
-- index, so nothing existing is constrained.
-- Index names for scripts/check-index-concurrency.mjs: courier_withdrawals_courierId_idempotencyKey_key
-- and withdrawals_franchiseOwnerId_idempotencyKey_key. Built here, not in create-indexes.sh: the
-- columns are created by this very migration and every value is NULL, so the build is instant.
ALTER TABLE "courier_withdrawals" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "withdrawals" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "courier_withdrawals_courierId_idempotencyKey_key"
  ON "courier_withdrawals" ("courierId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "withdrawals_franchiseOwnerId_idempotencyKey_key"
  ON "withdrawals" ("franchiseOwnerId", "idempotencyKey");
