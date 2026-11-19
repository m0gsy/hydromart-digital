-- Rolls back 20261119190000_flag_courier_one_tap.
-- Removes the row. The Ops app reads the flag fail-closed, so a missing row means the two
-- separate check-ins again — the same as OFF.
DELETE FROM "feature_flags" WHERE "key" = 'attendance.courier_one_tap';
