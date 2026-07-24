-- Rollback 0001_init: drop the entire HR schema (dev/staging only; irreversible).
DROP TABLE IF EXISTS "audit_logs","service_settings","performance_reviews","deductions","bonuses","payroll_items","payrolls","holidays","shifts","attendance_adjustments","attendance","face_embeddings","employment_history","employees" CASCADE;
DROP TYPE IF EXISTS "DeductionType","BonusType","PayrollItemKind","PayrollStatus","AttendanceStatus","EmployeeStatus","SalaryType","EmploymentStatus";
