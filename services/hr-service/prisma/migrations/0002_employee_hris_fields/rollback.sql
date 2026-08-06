-- Rollback for 0002_employee_hris_fields.
-- LOSSY AND PAYROLL-AFFECTING: NPWP and both BPJS numbers are tax and social-security
-- identifiers that cannot be re-derived — they have to be collected from employees again.
-- The supervisor link and shift assignment go with them.
ALTER TABLE "employees" DROP COLUMN IF EXISTS "bpjsTk";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "bpjsKes";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "npwp";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "shiftId";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "supervisorId";
