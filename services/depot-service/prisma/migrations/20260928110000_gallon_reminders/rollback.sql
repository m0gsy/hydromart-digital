-- Rollback for 20260928110000_gallon_reminders.
--
-- Drops the table. The only thing lost is WHEN each overdue customer was last reminded; with
-- it gone the next sweep may remind them once more, which is the worst case.
DROP TABLE "gallon_reminders";
