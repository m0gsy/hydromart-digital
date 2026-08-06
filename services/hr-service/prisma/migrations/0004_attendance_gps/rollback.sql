-- Rollback for 0004_attendance_gps.
-- LOSSY: the check-in and check-out coordinates on every attendance row are discarded, so
-- past punches can no longer be shown to have happened at the depot.
ALTER TABLE "attendance" DROP COLUMN IF EXISTS "checkOutLng";
ALTER TABLE "attendance" DROP COLUMN IF EXISTS "checkOutLat";
ALTER TABLE "attendance" DROP COLUMN IF EXISTS "checkInLng";
ALTER TABLE "attendance" DROP COLUMN IF EXISTS "checkInLat";
