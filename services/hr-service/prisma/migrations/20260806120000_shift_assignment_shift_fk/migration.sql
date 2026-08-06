-- B2: `shift_assignments."shiftId"` was a bare UUID column with no foreign key, so deleting
-- a shift still in use left every assignment pointing at nothing. `shiftIdForDay` then
-- returns an id `findById` cannot resolve, `assignedShiftStart` becomes null, and the
-- clock-in time drops to the depot shift and then to `workStartTime` — lateness changes for
-- everyone on that shift, and `lateMinutes` reaches payroll, with no trace anywhere.
--
-- The service now refuses the delete (ShiftService.remove counts references first). This is
-- the half that holds when the service is not in the path: a manual DELETE, a script, a
-- future code path that forgets.
--
-- Deliberately SQL-only, NOT added to schema.prisma — same as delivery-service's
-- `shifts_one_open_per_driver`. Declaring it in the schema would make Prisma expect a
-- relation field on both models and report drift forever.
--
-- Two steps on purpose. NOT VALID adds the constraint without scanning the table, so
-- dangling rows that may already exist in production cannot fail the migration; new and
-- updated rows are checked from this moment. VALIDATE then scans, and IS allowed to fail —
-- if it does, the dangling rows are real data to look at, not something to skip past.
ALTER TABLE "shift_assignments"
  DROP CONSTRAINT IF EXISTS "shift_assignments_shiftId_fkey";

ALTER TABLE "shift_assignments"
  ADD CONSTRAINT "shift_assignments_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "shifts"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "shift_assignments"
  VALIDATE CONSTRAINT "shift_assignments_shiftId_fkey";
