-- HR alignment with the 13-role RBAC (F4).
--
-- Three changes that belong together because the first one only works if the second
-- catches what it drops:
--
--  1. `Employee.role` — the login role, recorded locally. Payroll needs the jabatan
--     (KEPALA_DEPOT gets the tenure raise) and the HR console needs to show it without a
--     call into auth-service.
--  2. `EmploymentStatus` loses `DEPOT_MANAGER`. It was never a status: it made "depot head"
--     and "on probation" mutually exclusive, and it is the value payroll read for the
--     tenure raise. Those rows become PERMANENT (what they were in practice) and carry
--     their jabatan over into the new `role` column, so payroll pays exactly the same
--     people the day after this runs.
--  3. `depotId` becomes nullable — an Asisten SPV / SPV / Manager / Direktur is a full
--     employee (attendance, payroll) but is not stationed at one depot.
--
-- Nothing else is backfilled. A role guessed from a job title would be a login role nobody
-- granted; NULL is the honest value and payroll treats it as "not a depot head".

CREATE TYPE "Role" AS ENUM (
  'CUSTOMER',
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
  'DIREKTUR',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'FINANCE',
  'MARKETING',
  'HR',
  'SUPER_ADMIN'
);

ALTER TABLE "employees" ADD COLUMN "role" "Role";

-- Carry the jabatan over BEFORE the old status value disappears.
UPDATE "employees" SET "role" = 'KEPALA_DEPOT' WHERE "employmentStatus" = 'DEPOT_MANAGER';

UPDATE "employees" SET "employmentStatus" = 'PERMANENT' WHERE "employmentStatus" = 'DEPOT_MANAGER';

-- Postgres cannot drop a value from an enum, so the type is rebuilt and swapped in.
ALTER TYPE "EmploymentStatus" RENAME TO "EmploymentStatus_old";

CREATE TYPE "EmploymentStatus" AS ENUM ('TRAINING', 'PROBATION', 'PERMANENT');

ALTER TABLE "employees"
  ALTER COLUMN "employmentStatus" TYPE "EmploymentStatus"
  USING "employmentStatus"::text::"EmploymentStatus";

DROP TYPE "EmploymentStatus_old";

ALTER TABLE "employees" ALTER COLUMN "depotId" DROP NOT NULL;

-- Both copy the employee's depot so a queue can be scoped without a join, so both inherit
-- the null. `depotId IN (…)` never matches NULL, which is exactly right: these rows fall
-- OUT of a depot queue and land with HQ/HR, rather than showing up in every depot at once.
ALTER TABLE "attendance" ALTER COLUMN "depotId" DROP NOT NULL;

ALTER TABLE "leave_requests" ALTER COLUMN "depotId" DROP NOT NULL;
