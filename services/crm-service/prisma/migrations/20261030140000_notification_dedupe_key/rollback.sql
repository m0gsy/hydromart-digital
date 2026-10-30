DROP INDEX IF EXISTS "notifications_dedupeKey_key";
ALTER TABLE "notifications" DROP COLUMN IF EXISTS "dedupeKey";
