-- RERUNNABLE: ADD COLUMN IF NOT EXISTS.
-- DEP-05 (COD_VARIANCE): when HQ rejects a cash-variance approval, the shortfall is recorded on
-- the shift as the cashier's liability. Nullable and additive: NULL = nothing owed, which is
-- what every existing row means. No cash moves automatically; the amount is shown to the
-- cashier at their next shift.
ALTER TABLE "cashier_shifts" ADD COLUMN IF NOT EXISTS "liabilityIdr" INTEGER;
