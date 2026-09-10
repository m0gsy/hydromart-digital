-- Undoes 20260910090000_loan_requests.
--
-- LOSSY, and said plainly: dropping the table destroys every kasbon request ever raised,
-- including the pending ones nobody has answered yet. The APPROVED ones are the safer
-- half — their money lives in `loans`, which this does not touch, so payroll keeps
-- deducting exactly what it was deducting. What is lost is the paper trail: who asked,
-- what they asked for, who said yes, and why anyone said no.
--
-- If that trail matters, copy it out BEFORE running this:
--
--   \copy (SELECT * FROM "loan_requests") TO 'loan_requests.csv' CSV HEADER
--
-- The enum is dropped after the table, because a type cannot be dropped while a column
-- still uses it.

DROP INDEX IF EXISTS "loan_requests_employee_pending_key";
DROP INDEX IF EXISTS "loan_requests_depotId_status_idx";
DROP INDEX IF EXISTS "loan_requests_employeeId_createdAt_idx";
DROP TABLE IF EXISTS "loan_requests";
DROP TYPE IF EXISTS "LoanRequestStatus";
