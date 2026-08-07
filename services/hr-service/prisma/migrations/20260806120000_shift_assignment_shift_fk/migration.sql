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
-- Three steps, and the middle one is why this file changed after it was first written.
--
-- NOT VALID adds the constraint without scanning the table. VALIDATE then scans, and the
-- first deploy that ran it found the very rows this constraint exists to prevent:
--
--   ERROR: insert or update on table "shift_assignments" violates foreign key constraint
--   Key (shiftId)=(0a24c793-…) is not present in table "shifts"
--
-- So production already held assignments naming a shift somebody had deleted. That is not
-- something to skip past — and it is not something a deploy can pause on either: a failed
-- migration blocks every later one (Prisma P3018) until a human runs `migrate resolve`.
--
-- They are set to NULL rather than deleted. NULL is this column's own word for "no shift
-- assigned" — the sibling `rotationId` relation already says `onDelete: SetNull` for
-- exactly this situation — and it keeps the roster row, which records WHO was rostered on
-- that date. Deleting would throw that away to fix a pointer. Lateness for those rows falls
-- back to the depot shift and then `workStartTime`, which is what it has been doing since
-- the shift was deleted anyway; this only makes the data say so.
--
-- The id that was there is written into `note` first, so the row still testifies to what it
-- used to point at and this is not a silent edit. (Every SET expression reads the pre-update
-- row, so `a."shiftId"` below is the old value.)
ALTER TABLE "shift_assignments"
  DROP CONSTRAINT IF EXISTS "shift_assignments_shiftId_fkey";

ALTER TABLE "shift_assignments"
  ADD CONSTRAINT "shift_assignments_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "shifts"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE
  NOT VALID;

UPDATE "shift_assignments" a
SET "note" = concat_ws(
      ' | ',
      a."note",
      'shift ' || a."shiftId"::text || ' sudah dihapus sebelum foreign key dipasang'
    ),
    "shiftId" = NULL
WHERE a."shiftId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "shifts" s WHERE s."id" = a."shiftId");

ALTER TABLE "shift_assignments"
  VALIDATE CONSTRAINT "shift_assignments_shiftId_fkey";
