-- RERUNNABLE: HD-15, a maintenance item is due by days OR by water volume, whichever comes first.
-- Additive for rows: the volume limit is new and optional; the day interval and the next-due date
-- stop being mandatory because a volume-only item has neither. Existing rows keep their values.
ALTER TABLE "maintenance_items" ADD COLUMN IF NOT EXISTS "intervalM3" DECIMAL(12,3);
ALTER TABLE "maintenance_items" ALTER COLUMN "intervalDays" DROP NOT NULL;
ALTER TABLE "maintenance_items" ALTER COLUMN "nextDueAt" DROP NOT NULL;
