-- Rollback for 20260917120000_payout_rule_authors. Loses only the author of rules applied
-- since; deploy the previous image first, or its inserts name a column that is gone.
ALTER TABLE "commission_schemes" DROP COLUMN IF EXISTS "createdBy";
ALTER TABLE "courier_earning_rules" DROP COLUMN IF EXISTS "createdBy";
