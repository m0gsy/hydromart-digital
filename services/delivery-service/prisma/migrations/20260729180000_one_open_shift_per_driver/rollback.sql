-- Rollback for 20260729180000_one_open_shift_per_driver.
--
-- Safe for the data, but it REMOVES A GUARD: this partial unique index is what stops one
-- driver holding two open shifts at once, which is how the same courier gets paid twice
-- for one day. The service check alone is a read-then-write and does not survive
-- concurrency.
DROP INDEX IF EXISTS "shifts_one_open_per_driver";
