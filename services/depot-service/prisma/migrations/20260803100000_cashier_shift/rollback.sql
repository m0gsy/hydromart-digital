-- Rollback for 20260803100000_cashier_shift.
--
-- LOSSY AND FINANCIAL: every counter cashier shift is deleted — opening float, counted
-- cash, expected cash and variance. That is the reconciliation record for the drawer.
-- Export it before running this, and only run it when no shift is OPEN.
DROP TABLE IF EXISTS "cashier_shifts";
DROP TYPE IF EXISTS "CashierShiftStatus";
