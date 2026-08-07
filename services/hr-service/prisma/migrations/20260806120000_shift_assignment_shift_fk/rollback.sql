-- Rollback for 20260806120000_shift_assignment_shift_fk.
--
-- Safe for the data, but it REMOVES A GUARD: without this foreign key a shift can be
-- deleted out from under the assignments that name it, and the only symptom is that
-- everybody on that shift is judged late against a different start time. Nothing errors.
ALTER TABLE "shift_assignments"
  DROP CONSTRAINT IF EXISTS "shift_assignments_shiftId_fkey";
