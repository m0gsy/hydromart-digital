-- RERUNNABLE: ADD COLUMN IF NOT EXISTS.
-- DEP-05 follow-up: a recorded cashier liability can be settled/waived by a manager. Nullable and
-- additive: NULL = not settled, which is what every existing row means.
ALTER TABLE "cashier_shifts" ADD COLUMN IF NOT EXISTS "liabilitySettledAt" TIMESTAMP(3);
ALTER TABLE "cashier_shifts" ADD COLUMN IF NOT EXISTS "liabilitySettledBy" TEXT;
ALTER TABLE "cashier_shifts" ADD COLUMN IF NOT EXISTS "liabilityNote" TEXT;
