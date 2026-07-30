-- Rollback 0007_allowance.
--
-- HONEST LIMIT: Postgres cannot remove a value from an enum, so 'ALLOWANCE' stays in
-- "PayrollItemKind" after this runs. Dropping and recreating the type would require
-- rewriting every payroll_items row, which is a worse trade than a spare enum label that
-- nothing writes once the table is gone. Any payslip line already stamped ALLOWANCE is
-- deleted below, so no row is left pointing at a meaning the code no longer has.
-- Note: a payroll already generated keeps the allowance inside its stored `gross`. Re-generate
-- any DRAFT payroll after rolling back; APPROVED/PAID ones are locked history either way.
DELETE FROM "payroll_items" WHERE "kind" = 'ALLOWANCE';

DROP TABLE IF EXISTS "allowances";
DROP TYPE IF EXISTS "AllowanceType";
