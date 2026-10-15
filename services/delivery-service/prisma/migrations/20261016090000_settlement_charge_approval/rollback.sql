-- Reverses 20261016090000_settlement_charge_approval.
-- Rows with a charge awaiting approval lose that request and fall back to a plain
-- unresolved deposit; the cashier raises the charge again. Nothing already charged moves.
ALTER TABLE "cash_settlements" DROP COLUMN IF EXISTS "chargeRequestedAt";
ALTER TABLE "cash_settlements" DROP COLUMN IF EXISTS "chargeRequestedBy";
