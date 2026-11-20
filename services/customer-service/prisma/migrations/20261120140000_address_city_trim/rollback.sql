-- Rolls back 20261120140000_address_city_trim.
-- Nothing to undo: the update only removed leading and trailing spaces, which nothing reads.
-- Kept as a no-op so every migration has its rollback.
SELECT 1;
