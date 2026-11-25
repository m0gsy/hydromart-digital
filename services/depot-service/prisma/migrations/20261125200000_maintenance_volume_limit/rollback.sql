-- Rolls back 20261125200000_maintenance_volume_limit (depot-service, HD-15).
-- Lossy: the volume limit is dropped. A volume-only item gets a 365-day interval and a next-due
-- date a year out so the old NOT NULL columns can come back.
UPDATE "maintenance_items" SET "intervalDays" = 365 WHERE "intervalDays" IS NULL;
UPDATE "maintenance_items" SET "nextDueAt" = CURRENT_TIMESTAMP + INTERVAL '365 days' WHERE "nextDueAt" IS NULL;
ALTER TABLE "maintenance_items" ALTER COLUMN "nextDueAt" SET NOT NULL;
ALTER TABLE "maintenance_items" ALTER COLUMN "intervalDays" SET NOT NULL;
ALTER TABLE "maintenance_items" DROP COLUMN IF EXISTS "intervalM3";
