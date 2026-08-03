-- Reverses 20260803160000_service_settings_unique. Drops both guards; the deleted duplicate rows are NOT restored —
-- they were the defect. Settings go back to accepting two rows for one key.

DROP INDEX IF EXISTS "service_settings_depot_key_key";
DROP INDEX IF EXISTS "service_settings_global_key_key";
