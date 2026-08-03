-- Rollback for 20260804160000_backup_status_writer.
-- Lossy by design: the recorded backup/drill detail and the last drill verdict are
-- dropped. `status` and `lastBackupAt` predate this migration and survive.
ALTER TABLE "backup_status" DROP COLUMN IF EXISTS "drillDetail";
ALTER TABLE "backup_status" DROP COLUMN IF EXISTS "lastDrillAt";
ALTER TABLE "backup_status" DROP COLUMN IF EXISTS "drillStatus";
ALTER TABLE "backup_status" DROP COLUMN IF EXISTS "detail";
