-- Reverses 20260804170000_depot_daily_close.
--
-- Destructive: every recorded close is lost. Safe only while the feature is unused —
-- once depots have closed days, this discards the record of who signed off on what.
DROP TABLE IF EXISTS "depot_daily_closes";
