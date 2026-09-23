-- HR-4, owner decision 2026-09-17: attendance selfies of ACTIVE staff had no window at all.
-- 90 days, tunable by head office in the retention console like every other policy here.
--
-- RERUNNABLE: inserted only when the dataset is absent, and the id is generated rather than
-- literal — a hand-picked one collided with a seeded row the first time this ran.
INSERT INTO "retention_policies" ("id", "dataset", "windowLabel", "windowDays", "dataClass", "updatedAt")
SELECT gen_random_uuid()::text, 'hr_attendance_photos', '90 hari (foto absensi)', 90, 'HR', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "retention_policies" WHERE "dataset" = 'hr_attendance_photos'
);
