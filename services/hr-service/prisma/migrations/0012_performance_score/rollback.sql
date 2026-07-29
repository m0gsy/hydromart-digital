-- Rollback 0012_performance_score. The final score in "score" survives; only the breakdown
-- and the manager's note go. Both are recoverable by re-running generate for the period —
-- except managerNote, which is a human's words and is gone for good.
ALTER TABLE "performance_reviews" DROP COLUMN IF EXISTS "managerNote";
ALTER TABLE "performance_reviews" DROP COLUMN IF EXISTS "salesScore";
ALTER TABLE "performance_reviews" DROP COLUMN IF EXISTS "disciplineScore";
ALTER TABLE "performance_reviews" DROP COLUMN IF EXISTS "attendanceScore";
