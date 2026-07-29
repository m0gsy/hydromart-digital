-- Rollback 0006_leave.
--
-- Attendance rows written by an approved leave are LEFT IN PLACE on purpose: they are the
-- record that somebody did not have to be at work that day, and payroll has already been
-- computed from them. Deleting them here would turn approved leave into unexplained absence.
DROP TABLE IF EXISTS "leave_balances";
DROP TABLE IF EXISTS "leave_requests";
DROP TYPE IF EXISTS "LeaveStatus";
DROP TYPE IF EXISTS "LeaveType";
