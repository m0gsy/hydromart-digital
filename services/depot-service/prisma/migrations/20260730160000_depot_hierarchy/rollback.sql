-- Dropping the hierarchy returns every multi-depot role to seeing nothing, which is the
-- pre-F3 state (the supervision roles did not exist and nothing else reads these tables).
-- Depot rows are untouched apart from losing the assistant column.
DROP TABLE IF EXISTS "staff_depot_assignments";
DROP TABLE IF EXISTS "staff_supervision";
DROP INDEX IF EXISTS "depots_assistantSupervisorId_idx";
ALTER TABLE "depots" DROP COLUMN IF EXISTS "assistantSupervisorId";
