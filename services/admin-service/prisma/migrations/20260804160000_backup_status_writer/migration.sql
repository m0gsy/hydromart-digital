-- H-37/H-36: the backup-status view had no writer. Give the row somewhere to record what
-- actually happened, and keep the tested-restore verdict separate from the dump's.
ALTER TABLE "backup_status" ADD COLUMN "detail" TEXT;
ALTER TABLE "backup_status" ADD COLUMN "drillStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "backup_status" ADD COLUMN "lastDrillAt" TIMESTAMP(3);
ALTER TABLE "backup_status" ADD COLUMN "drillDetail" TEXT;
