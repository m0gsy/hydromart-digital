-- Undoes 20261009120000_depot_assignment_foundation.
--
-- LOSSY, and said plainly: dropping the tables destroys the move ledger, every planned or
-- applied assignment, and every per-depot payslip share. Payslips themselves (`payrolls`,
-- `payroll_items`) are untouched, so slip totals survive; what is lost is WHICH depot owed
-- which part, and where anyone was lent. Dropping `homeDepotId` loses only a copy of
-- `depotId` taken at backfill time - unless somebody is lent out right now, in which case it
-- is the only record of where they belong.
--
-- If that history matters, copy it out BEFORE running this:
--
--   \copy (SELECT * FROM "employee_depot_moves") TO 'employee_depot_moves.csv' CSV HEADER
--   \copy (SELECT * FROM "employee_depot_assignments") TO 'employee_depot_assignments.csv' CSV HEADER
--   \copy (SELECT * FROM "payroll_depot_shares") TO 'payroll_depot_shares.csv' CSV HEADER
--   \copy (SELECT id, "employeeCode", "homeDepotId", "depotId" FROM employees) TO 'home_depots.csv' CSV HEADER
--
-- Types are dropped after the tables, because a type cannot be dropped while a column
-- still uses it.

DROP TRIGGER IF EXISTS "employee_depot_moves_no_update" ON "employee_depot_moves";
DROP FUNCTION IF EXISTS employee_depot_moves_no_update();

DROP INDEX IF EXISTS "payroll_depot_shares_depotId_payrollId_idx";
DROP INDEX IF EXISTS "payroll_depot_shares_payrollId_depotId_key";
DROP INDEX IF EXISTS "employee_depot_assignments_status_endDate_idx";
DROP INDEX IF EXISTS "employee_depot_assignments_status_startDate_idx";
DROP INDEX IF EXISTS "employee_depot_assignments_employeeId_startDate_idx";
DROP INDEX IF EXISTS "employee_depot_moves_employeeId_effectiveDate_idx";

DROP TABLE IF EXISTS "payroll_depot_shares";
DROP TABLE IF EXISTS "employee_depot_assignments";
DROP TABLE IF EXISTS "employee_depot_moves";

DROP TYPE IF EXISTS "DepotAssignmentStatus";
DROP TYPE IF EXISTS "DepotAssignmentKind";
DROP TYPE IF EXISTS "DepotMoveKind";

ALTER TABLE "employees" DROP COLUMN IF EXISTS "homeDepotId";
