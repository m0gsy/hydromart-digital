-- Rollback for 20260923120000_hr_audit_retention: the sweep stops, the HR trail is kept again.
DELETE FROM "retention_policies" WHERE "dataset" = 'hr_audit_logs';
