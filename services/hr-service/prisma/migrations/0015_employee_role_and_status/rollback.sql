-- Rollback 0015_employee_role_and_status.
--
-- DEPOT_MANAGER comes back the same way it left: a rebuilt enum type swapped in, NOT
-- `ALTER TYPE ... ADD VALUE`. Postgres refuses to USE a value added by ADD VALUE inside
-- the same transaction, and this file has to write that value immediately, so the rebuild
-- is the only form that runs as one unit.
--
-- Order matters: restore the rows that carried the old status (identified by `role`, the
-- only record left of them) BEFORE dropping the column that tells us who they were.
--
-- Employees created while this migration was in force with no depot at all cannot be
-- rolled back — there is no depot to invent for them, so they are deleted. That is the
-- lossy part, and it is deliberate rather than a failed NOT NULL halfway through.

ALTER TYPE "EmploymentStatus" RENAME TO "EmploymentStatus_new";

CREATE TYPE "EmploymentStatus" AS ENUM ('TRAINING', 'PROBATION', 'PERMANENT', 'DEPOT_MANAGER');

ALTER TABLE "employees"
  ALTER COLUMN "employmentStatus" TYPE "EmploymentStatus"
  USING "employmentStatus"::text::"EmploymentStatus";

DROP TYPE "EmploymentStatus_new";

UPDATE "employees" SET "employmentStatus" = 'DEPOT_MANAGER' WHERE "role" = 'KEPALA_DEPOT';

DELETE FROM "employees" WHERE "depotId" IS NULL;

ALTER TABLE "employees" ALTER COLUMN "depotId" SET NOT NULL;

ALTER TABLE "employees" DROP COLUMN "role";

DROP TYPE "Role";

-- Attendance and leave rows for network-level staff went with their employees above.
ALTER TABLE "attendance" ALTER COLUMN "depotId" SET NOT NULL;

ALTER TABLE "leave_requests" ALTER COLUMN "depotId" SET NOT NULL;
