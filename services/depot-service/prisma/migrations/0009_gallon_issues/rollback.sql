-- Rollback for 0009_gallon_issues.
-- LOSSY AND FINANCIAL: every gallon issued to a customer is deleted, together with the
-- deposit held against it — so the depot loses the record of deposits it still owes back.
DROP TABLE IF EXISTS "gallon_issues";
