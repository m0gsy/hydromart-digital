-- 0005_broadcast_scheduled_level
-- Adds the "Terjadwal" (SCHEDULED) tier to depot broadcasts (design 8a: 3 levels —
-- Mendesak / Terjadwal / Info). ALTER TYPE ... ADD VALUE must run on its own — a newly
-- added enum value cannot be used in the same transaction it is created in, so it gets a
-- dedicated migration (DB-14 convention).
ALTER TYPE "BroadcastLevel" ADD VALUE IF NOT EXISTS 'SCHEDULED';
