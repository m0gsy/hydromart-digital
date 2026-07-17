-- Rollback for 0003_depot_broadcasts.
DROP TABLE IF EXISTS "depot_broadcast_reads";
DROP TABLE IF EXISTS "depot_broadcasts";
DROP TYPE IF EXISTS "BroadcastLevel";
