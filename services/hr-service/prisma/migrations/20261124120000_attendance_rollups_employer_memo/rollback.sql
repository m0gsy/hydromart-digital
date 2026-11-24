-- Reverses 20261124120000_attendance_rollups_employer_memo.
--
-- THIS DROPS DATA: every attendance month rollup goes, and for months whose raw attendance the
-- retention scrub already deleted that is the only record of who was present, so the HR
-- attendance export loses those months. The employer-memo column is rebuilt by regenerating a
-- DRAFT; on APPROVED/PAID slips the employer-cost report falls back to computing from the
-- employee's depot rates, as it did before the memo existed.
DROP TABLE IF EXISTS "attendance_month_rollups";
ALTER TABLE "payrolls" DROP COLUMN IF EXISTS "employerMemo";
