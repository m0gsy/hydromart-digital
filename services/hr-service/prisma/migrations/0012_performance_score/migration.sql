-- C2 Performance scoring. The final `score` column already exists; these hold the components
-- behind it and the manager's own words.
--
-- The component columns are NULLABLE on purpose. NULL means "not measurable this period" —
-- no scheduled working days, nobody attended, no sales target configured — which is not the
-- same as a zero, and scoring it zero would mark somebody down for a figure nobody collected.
ALTER TABLE "performance_reviews" ADD COLUMN "attendanceScore" DECIMAL(5,2);
ALTER TABLE "performance_reviews" ADD COLUMN "disciplineScore" DECIMAL(5,2);
ALTER TABLE "performance_reviews" ADD COLUMN "salesScore"      DECIMAL(5,2);

-- Kept apart from "note" so recomputing a score never overwrites what a human wrote.
ALTER TABLE "performance_reviews" ADD COLUMN "managerNote" TEXT;

-- No backfill: existing reviews were entered by hand with no components behind them, and
-- inventing a breakdown for them would be fabricated data.
