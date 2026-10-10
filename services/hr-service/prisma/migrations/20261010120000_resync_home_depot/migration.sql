-- Re-sync `homeDepotId` for anyone who is not currently lent out.
--
-- 20261009120000 backfilled `homeDepotId = depotId` once. Between that deploy and the one that
-- made every depot change write the new home too, a depot could still be changed by code that
-- knew nothing about the column, leaving a stale home on a person who was never lent anywhere.
-- Home is now the gate for HR money and papers (`EmployeeService.getById`), so a stale home
-- would lock the CURRENT depot's manager out of their own employee.
--
-- RERUNNABLE: it only ever sets home = live depot where the two disagree AND nobody is on an
-- active loan, so a second run touches nothing, and it can never un-lend a real loan.
UPDATE "employees" e
SET "homeDepotId" = e."depotId"
WHERE e."depotId" IS NOT NULL
  AND e."homeDepotId" IS DISTINCT FROM e."depotId"
  AND NOT EXISTS (
    SELECT 1 FROM "employee_depot_assignments" a
    WHERE a."employeeId" = e."id" AND a."status" = 'ACTIVE' AND a."kind" = 'LOAN'
  );
