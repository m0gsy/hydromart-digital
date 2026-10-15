-- RERUNNABLE: both statements are ADD COLUMN IF NOT EXISTS, so a retry after a deploy failure is safe.
-- Charging a COD shortfall to a courier needs a SECOND person (owner decision 2026-10-16).
-- `chargeRequestedBy` is who raised the charge; the row stays SUBMITTED/DISPUTED until a
-- different person with the approvals capability approves (then VERIFIED, chargedToDriver)
-- or rejects (both columns cleared). NULL = no charge awaiting approval, which is every
-- existing row, and correct.
ALTER TABLE "cash_settlements" ADD COLUMN IF NOT EXISTS "chargeRequestedBy" UUID;
ALTER TABLE "cash_settlements" ADD COLUMN IF NOT EXISTS "chargeRequestedAt" TIMESTAMP(3);
