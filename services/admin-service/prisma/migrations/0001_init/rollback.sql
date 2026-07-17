-- Rollback for 0001_init.
DROP TABLE IF EXISTS "system_settings";
DROP TABLE IF EXISTS "feature_flags";
DROP TYPE IF EXISTS "FlagState";
