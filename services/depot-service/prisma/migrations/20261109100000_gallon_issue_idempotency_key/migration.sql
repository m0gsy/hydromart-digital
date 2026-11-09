-- RERUNNABLE: the client's key for ONE manual gallon-issue submission (DEP-07). Nullable and
-- additive, so the fulfilment path (idempotent on its order) and every existing row are untouched;
-- NULLs are distinct in a unique index, so an issue without a key can never collide.
ALTER TABLE "gallon_issues" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "gallon_issues_depotId_idempotencyKey_key"
  ON "gallon_issues"("depotId", "idempotencyKey");
