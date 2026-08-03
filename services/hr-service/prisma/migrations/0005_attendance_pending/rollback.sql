-- Rollback for 0005_attendance_pending.
--
-- ORDER-SENSITIVE. Postgres cannot drop a single value from an enum type, so any row still
-- sitting in PENDING has to be resolved first — otherwise the pre-migration code reads a
-- status its enum does not contain.
--
-- PENDING means "punched, awaiting approval". Rejecting them wholesale would erase real
-- attendance, so they are moved to ABSENT, which is the state HR reviews and corrects.
-- Decide deliberately: approving them instead is a one-line change to this UPDATE.
UPDATE "attendance" SET "status" = 'ABSENT' WHERE "status" = 'PENDING';

-- The unused 'PENDING' label is deliberately LEFT on the enum type. Removing it means
-- recreating the type and rewriting every column that uses it, under a lock, to delete a
-- label nothing references.
