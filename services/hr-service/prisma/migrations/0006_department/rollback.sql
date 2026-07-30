-- Rollback 0006_department. Drops the assignment column first: departments would otherwise
-- be referenced by employee rows the console still renders.
DROP INDEX IF EXISTS "employees_departmentId_idx";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "departmentId";

DROP TABLE IF EXISTS "departments";
