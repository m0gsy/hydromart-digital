-- Undoes 20260812010000_employee_exit_date.
--
-- LOSSY, and say so plainly: dropping the column destroys every recorded leaving date.
-- There is nowhere else in the schema that holds it — `status = 'RESIGNED'` records THAT
-- someone left, never WHEN. Re-applying the migration afterwards gives every row NULL back,
-- and payroll would then pay a full month to people who left on the 3rd.
--
-- Before running this on production, export it:
--   \copy (SELECT id, "employeeCode", "exitDate" FROM employees WHERE "exitDate" IS NOT NULL) TO 'exit-dates.csv' CSV HEADER
ALTER TABLE "employees" DROP COLUMN IF EXISTS "exitDate";
