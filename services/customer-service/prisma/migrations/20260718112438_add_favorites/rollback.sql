-- Rollback for 20260718112438_add_favorites.
-- LOSSY: every customer's saved favourites are deleted with the table.
DROP TABLE IF EXISTS "favorites";
