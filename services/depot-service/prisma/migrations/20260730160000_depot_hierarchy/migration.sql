-- Supervision hierarchy above the depot (F3).
--
-- Additive: the scope resolver ships in the same release, but with no rows here every
-- multi-depot role resolves to an empty set and is denied. Access only changes once a
-- SUPER_ADMIN assigns depots.

ALTER TABLE "depots" ADD COLUMN IF NOT EXISTS "assistantSupervisorId" UUID;
CREATE INDEX IF NOT EXISTS "depots_assistantSupervisorId_idx" ON "depots"("assistantSupervisorId");

-- One row per subordinate: the primary key IS the "exactly one superior" rule.
CREATE TABLE IF NOT EXISTS "staff_supervision" (
  "staffId"    UUID NOT NULL,
  "superiorId" UUID NOT NULL,
  "updatedBy"  UUID,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_supervision_pkey" PRIMARY KEY ("staffId")
);
CREATE INDEX IF NOT EXISTS "staff_supervision_superiorId_idx" ON "staff_supervision"("superiorId");

-- Direct grants, unioned with the hierarchy walk.
CREATE TABLE IF NOT EXISTS "staff_depot_assignments" (
  "staffId"   UUID NOT NULL,
  "depotId"   UUID NOT NULL,
  "updatedBy" UUID,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_depot_assignments_pkey" PRIMARY KEY ("staffId", "depotId")
);
CREATE INDEX IF NOT EXISTS "staff_depot_assignments_staffId_idx" ON "staff_depot_assignments"("staffId");
