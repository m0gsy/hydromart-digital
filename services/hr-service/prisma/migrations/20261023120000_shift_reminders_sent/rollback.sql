-- Rolls back 20261023120000_shift_reminders_sent.
-- Drops the send ledger. Lossy only in the harmless direction: reminders already sent are
-- forgotten, so a shift reminded today could be reminded again if the table is re-created.
DROP INDEX IF EXISTS "shift_reminders_sent_employeeId_workDate_key";
DROP TABLE IF EXISTS "shift_reminders_sent";
