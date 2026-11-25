-- Rollback for 20261126120000_depot_fixed_costs (HD-16 PR-A).
-- NOT lossless: every fixed cost imported is dropped. Roll the code back first (the release before
-- this one never reads the table), then run this.
DROP TABLE IF EXISTS "depot_fixed_costs";
