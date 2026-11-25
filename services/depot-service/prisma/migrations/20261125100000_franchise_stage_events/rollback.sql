-- Rolls back 20261125100000_franchise_stage_events (depot-service, HD-6 H5).
-- Lossy: the stage history recorded since is gone, and with it the count of rejected applications
-- that were already deleted. The applications themselves are untouched; the code before this
-- release never reads the table.
DROP INDEX IF EXISTS "franchise_application_stage_events_stage_applicationId_idx";
DROP TABLE IF EXISTS "franchise_application_stage_events";
