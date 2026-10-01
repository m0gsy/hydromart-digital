-- Rollback for 20260929100000_depot_monthly_close.
--
-- Drops the table. The only thing lost is the record of which months were sealed and by
-- whom; depot_daily_closes (unaffected) still holds every day's own figures, so no money
-- total is lost, only the month-level signature on top of them.
DROP TABLE "depot_monthly_closes";
