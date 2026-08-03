-- Rollback for 20260725171308_reseller_profiles.
-- LOSSY: the whole agen/reseller registry is deleted — home depot, monthly target, join
-- date and notes. Export it first if any reseller is live.
DROP TABLE IF EXISTS "reseller_profiles";
