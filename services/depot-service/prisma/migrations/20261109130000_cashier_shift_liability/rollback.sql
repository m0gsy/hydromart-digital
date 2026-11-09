-- Rolls back 20261109130000_cashier_shift_liability.
-- Drops the recorded liabilities; a rejected COD variance is no longer shown to the cashier.
ALTER TABLE "cashier_shifts" DROP COLUMN IF EXISTS "liabilityIdr";
