-- Rollback for 20261126090000_depot_target_gallons (HD-16 part A).
-- NOT lossless: the gallons goals managers entered are dropped; the other targets are untouched.
-- Roll the code back first (the release before this one never reads the column), then run this.
ALTER TABLE "depot_targets" DROP COLUMN IF EXISTS "gallonsTarget";
