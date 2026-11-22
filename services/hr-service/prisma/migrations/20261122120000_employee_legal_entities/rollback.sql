-- Reverses 20261122120000_employee_legal_entities.
--
-- THIS DROPS DATA: every dated employer record head office entered goes. Nothing else in
-- hydromart-digital reads it (payroll, attendance and the jabatan role do not), so no screen or
-- job other than /hq/legal-entities changes.
DROP TABLE IF EXISTS "employee_legal_entities";
