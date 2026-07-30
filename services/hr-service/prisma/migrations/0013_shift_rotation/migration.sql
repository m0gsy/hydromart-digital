-- C3 Shift rotation. Employee."shiftId" already existed but was never read; from here the
-- roster lives in shift_assignments, which is append-only so "which shift was Budi on in
-- March" survives a reassignment — it has to, because a late deduction can be disputed.

CREATE TABLE "shift_rotations" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "name"      TEXT NOT NULL,
  "depotId"   UUID,
  -- Keys "0".."6", 0 = Sunday (Date.getUTCDay). Value = shifts.id, or null for a day off.
  "pattern"   JSONB NOT NULL DEFAULT '{}',
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shift_rotations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shift_rotations_depotId_idx" ON "shift_rotations"("depotId");

CREATE TABLE "shift_assignments" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId"    UUID NOT NULL,
  "shiftId"       UUID,
  "rotationId"    UUID,
  "effectiveFrom" DATE NOT NULL,
  "note"          TEXT,
  "createdBy"     UUID,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

-- The lookup every single punch performs: this employee, everything already in force.
CREATE INDEX "shift_assignments_employeeId_effectiveFrom_idx"
  ON "shift_assignments"("employeeId", "effectiveFrom");

ALTER TABLE "shift_assignments"
  ADD CONSTRAINT "shift_assignments_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: deleting a rotation must not erase the roster history that used it.
ALTER TABLE "shift_assignments"
  ADD CONSTRAINT "shift_assignments_rotationId_fkey"
  FOREIGN KEY ("rotationId") REFERENCES "shift_rotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- No backfill. Every existing employee keeps being judged against the depot shift exactly as
-- before, because with no assignment row the resolver falls straight through to it.
