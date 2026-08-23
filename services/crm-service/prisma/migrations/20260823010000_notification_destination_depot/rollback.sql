-- Rollback for 20260823010000_notification_destination_depot.
-- Safe in both directions: nothing reads either column in this release, and the writer
-- tolerates their absence only in the sense that it is rolled back with them.
ALTER TABLE "notifications" DROP COLUMN IF EXISTS "depotId";
ALTER TABLE "notifications" DROP COLUMN IF EXISTS "destination";
