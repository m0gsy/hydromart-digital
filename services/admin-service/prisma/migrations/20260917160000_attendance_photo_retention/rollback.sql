-- Rollback for 20260917160000_attendance_photo_retention: the sweep stops running, and the
-- photos are kept again. The hr-service route itself is harmless without a policy row.
DELETE FROM "retention_policies" WHERE "dataset" = 'hr_attendance_photos';
