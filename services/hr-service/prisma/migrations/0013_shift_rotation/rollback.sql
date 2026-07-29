-- Rollback 0013_shift_rotation. Assignments go first (they reference the rotations).
--
-- Attendance already recorded keeps whatever lateMinutes it was stamped with; the resolver
-- simply falls back to the depot shift again for future punches. The roster history itself
-- is destroyed — it is written nowhere else.
DROP TABLE IF EXISTS "shift_assignments";
DROP TABLE IF EXISTS "shift_rotations";
