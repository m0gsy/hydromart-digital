-- RERUNNABLE: the client's key for ONE manual gallon-return submission (DEP-07). Nullable and
-- additive, so the courier path (idempotent on its order) and every existing row are untouched;
-- NULLs are distinct in a unique index, so a return without a key can never collide.
ALTER TABLE "gallon_returns" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "gallon_returns_depotId_idempotencyKey_key"
  ON "gallon_returns"("depotId", "idempotencyKey");
