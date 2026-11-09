-- Rolls back 20261109140000_cashier_liability_settle.
-- Forgets who settled which liability; every recorded liability reads as outstanding again.
ALTER TABLE "cashier_shifts" DROP COLUMN IF EXISTS "liabilityNote";
ALTER TABLE "cashier_shifts" DROP COLUMN IF EXISTS "liabilitySettledBy";
ALTER TABLE "cashier_shifts" DROP COLUMN IF EXISTS "liabilitySettledAt";
