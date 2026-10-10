-- A depot manager may ASK to borrow somebody; HR decides. The request is a row with its own
-- status so it never claims calendar days (OPEN_STATUSES stays PLANNED/ACTIVE) and the sweep
-- (which reads PLANNED/ACTIVE) can never apply it by accident.
-- Additive and rerunnable; rolling back leaves the label unused, which is harmless
-- (Postgres cannot drop an enum value).
ALTER TYPE "DepotAssignmentStatus" ADD VALUE IF NOT EXISTS 'REQUESTED';
