-- HR-4, owner decision 2026-09-17: attendance selfies of ACTIVE staff had no window at all.
-- 90 days, tunable by head office in the retention console like every other policy here.
INSERT INTO "retention_policies" ("id", "dataset", "windowLabel", "windowDays", "dataClass", "updatedAt")
VALUES (
  '11111111-0000-4000-a000-000000000007',
  'hr_attendance_photos',
  '90 hari (foto absensi)',
  90,
  'HR',
  NOW()
)
ON CONFLICT ("dataset") DO NOTHING;
