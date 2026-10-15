-- Rollback for 20261015100000_security_policy_idle_off.
--
-- Restores the COLUMN DEFAULT only. The migration also set every stored
-- "idleTimeoutMinutes" to 0, and the values it overwrote were not kept, so they cannot be
-- put back: this is NOT lossless. Anything that had been saved is gone; re-enter it from
-- /hq/security if the limit should be on again.
--
-- 15 is the default the column carried before the migration.
ALTER TABLE "security_policy" ALTER COLUMN "idleTimeoutMinutes" SET DEFAULT 15;
